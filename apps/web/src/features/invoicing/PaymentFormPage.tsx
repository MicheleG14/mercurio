import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchCombobox } from '@/components/shared/SearchCombobox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ApiError } from '@/lib/api';
import { decimalToInput, parseDecimalInput } from '@/lib/decimal';
import { businessToday, formatDate } from '@/lib/format';
import { uuidv7 } from '@/lib/uuid';
import { useInvoicingRights } from './hooks';
import {
  type CustomerOption,
  type ScheduleRow,
  useCustomerSearch,
  useDueDates,
  useRecordPayment,
  useReferenceData,
} from './queries';

const AMOUNT = { integerDigits: 12, scale: 2 };

/** "12.5" → 1250: amounts as whole cents, exact, for adding them up (B30: never floats). */
function cents(value: string): number {
  const [integer = '0', fraction = ''] = value.split('.');
  return Number(integer) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}
const fromCents = (value: number) =>
  `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}`;

/** The amount settles the open due dates from the oldest, as far as it goes. */
function propose(rows: readonly ScheduleRow[], amount: number): Map<string, number> {
  const proposal = new Map<string, number>();
  let left = amount;
  for (const row of rows) {
    const take = Math.min(left, cents(row.openAmount));
    if (take > 0) proposal.set(row.dueDateId, take);
    left -= take;
  }
  return proposal;
}

/**
 * `/invoicing/payments/new` (`?party=…&kind=RECEIPT|REFUND` from a document or the schedule):
 * a payment of a customer, spread on its open due dates. The id is chosen once (B33).
 */
export function PaymentFormPage() {
  const { t, i18n } = useTranslation('invoicing');
  const { t: tc } = useTranslation();
  const { t: tError } = useTranslation('errors');
  const language = i18n.language;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { pay } = useInvoicingRights();
  const customers = useCustomerSearch();
  const methods = useReferenceData().data?.paymentMethods ?? [];
  const record = useRecordPayment();
  const [id] = useState(() => uuidv7());
  const [kind, setKind] = useState<'RECEIPT' | 'REFUND'>(
    params.get('kind') === 'REFUND' ? 'REFUND' : 'RECEIPT',
  );
  const [partyId, setPartyId] = useState(params.get('party') ?? '');
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [date, setDate] = useState(businessToday());
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState('MP05');
  const [reference, setReference] = useState('');
  const [allocations, setAllocations] = useState<Map<string, string>>(new Map());

  const open = useDueDates({ page: 1, status: 'open', partyId, pageSize: 100 }, Boolean(partyId));
  const rows = (open.data?.items ?? []).filter((row) =>
    kind === 'RECEIPT' ? row.kind === 'INVOICE' : row.kind === 'CREDIT_NOTE',
  );
  const partyName = customer?.name ?? open.data?.items[0]?.partyName ?? '';
  const amount = parseDecimalInput(amountText, language, AMOUNT);
  const allocated = [...allocations.values()].reduce((sum, text) => {
    const value = parseDecimalInput(text, language, AMOUNT);
    return sum + (value ? cents(value) : 0);
  }, 0);

  const proposeFor = (text: string) => {
    const value = parseDecimalInput(text, language, AMOUNT);
    const proposal = propose(rows, value ? cents(value) : 0);
    setAllocations(
      new Map(
        [...proposal].map(([dueDateId, value]) => [
          dueDateId,
          decimalToInput(fromCents(value), language),
        ]),
      ),
    );
  };

  if (!pay) return <Navigate to="/invoicing/payments" replace />;

  const submit = async () => {
    if (!amount) return;
    await record
      .mutateAsync({
        id,
        kind,
        partyId,
        paymentDate: date,
        amount,
        method,
        reference: reference.trim() || null,
        allocations: [...allocations].flatMap(([dueDateId, text]) => {
          const value = parseDecimalInput(text, language, AMOUNT);
          return value && cents(value) > 0 ? [{ dueDateId, amount: value }] : [];
        }),
      })
      .then(() => void navigate('/invoicing/payments'))
      .catch(() => undefined);
  };
  const fieldErrors = record.error instanceof ApiError ? (record.error.problem?.errors ?? []) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('payments.form.title')} description={t('payments.form.description')} />
      {record.error && <ErrorMessage error={record.error} />}
      {fieldErrors.length > 0 && (
        <ul className="text-destructive text-sm">
          {fieldErrors.map((e) => (
            <li key={`${e.field}-${e.code}`}>{tError(`validation.${e.code}` as never)}</li>
          ))}
        </ul>
      )}
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <FormField label={t('payments.form.kind')}>
          {(p) => (
            <NativeSelect
              className="w-full"
              {...p}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as 'RECEIPT' | 'REFUND');
                setAllocations(new Map());
              }}
            >
              <NativeSelectOption value="RECEIPT">{t('payments.kind.RECEIPT')}</NativeSelectOption>
              <NativeSelectOption value="REFUND">{t('payments.kind.REFUND')}</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('payments.form.customer')}>
          {(p) => (
            <SearchCombobox<CustomerOption>
              {...p}
              value={
                customer ?? (partyId ? { id: partyId, name: partyName, vatNumber: null } : null)
              }
              onChange={(option) => {
                setCustomer(option);
                setPartyId(option?.id ?? '');
                setAllocations(new Map());
              }}
              queryKey={customers.queryKey}
              search={customers.search}
              itemKey={(party) => party.id}
              itemLabel={(party) => party.name}
              itemDetail={(party) => party.vatNumber}
              placeholder={t('editor.searchCustomer')}
            />
          )}
        </FormField>
        <FormField label={t('payments.form.date')}>
          {(p) => (
            <Input
              type="date"
              max={businessToday()}
              {...p}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('payments.form.amount')}>
          {(p) => (
            <DecimalInput
              {...p}
              value={amountText}
              onChange={(event) => {
                setAmountText(event.target.value);
                proposeFor(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t('payments.form.method')}>
          {(p) => (
            <NativeSelect
              className="w-full"
              {...p}
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              {methods.map((code) => (
                <NativeSelectOption key={code} value={code}>
                  {t(`methods.${code as 'MP05'}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('payments.form.reference')}>
          {(p) => (
            <Input
              autoComplete="off"
              maxLength={60}
              {...p}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
        </FormField>
      </div>

      {partyId && (
        <section className="flex max-w-3xl flex-col gap-2">
          <h2 className="text-sm font-medium">{t('payments.form.allocations')}</h2>
          {rows.length === 0 && !open.isPending && (
            <p className="text-muted-foreground text-sm">{t('payments.form.noOpen')}</p>
          )}
          <ul className="border-border divide-border divide-y rounded-lg border text-sm">
            {rows.map((row) => (
              <li
                key={row.dueDateId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
              >
                <span className="font-mono">{row.reference}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatDate(row.dueDate, language)}
                </span>
                <span className="flex-1">
                  <MoneyAmount value={row.openAmount} />
                </span>
                <DecimalInput
                  aria-label={`${row.reference} ${formatDate(row.dueDate, language)}`}
                  className="w-32"
                  value={allocations.get(row.dueDateId) ?? ''}
                  onChange={(event) =>
                    setAllocations((current) =>
                      new Map(current).set(row.dueDateId, event.target.value),
                    )
                  }
                />
              </li>
            ))}
          </ul>
          {amount && (
            <p
              role="status"
              className={
                cents(amount) === allocated
                  ? 'text-muted-foreground text-sm'
                  : 'text-warning text-sm'
              }
            >
              {t('payments.form.allocated', {
                allocated: decimalToInput(fromCents(allocated), language),
                amount: decimalToInput(amount, language),
              })}
            </p>
          )}
        </section>
      )}

      <div className="border-border flex max-w-3xl justify-end gap-3 border-t pt-4">
        <Button variant="outline" onClick={() => void navigate('/invoicing/payments')}>
          {tc('actions.cancel')}
        </Button>
        <Button
          disabled={!partyId || !amount || cents(amount) !== allocated || record.isPending}
          onClick={() => void submit()}
        >
          {t('payments.form.save')}
        </Button>
      </div>
    </div>
  );
}
