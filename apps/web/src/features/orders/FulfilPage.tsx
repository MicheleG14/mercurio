import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useBreakpoint } from '@/lib/breakpoint';
import { decimalToInput, parseDecimalInput, quantityLimits } from '@/lib/decimal';
import { businessToday } from '@/lib/format';
import { uuidv7 } from '@/lib/uuid';
import { useOrderRights, useQuantity } from './hooks';
import { type Order, useFulfil, useOrder } from './queries';

/** `/orders/:id/fulfil`: receiving a purchase order or shipping a sales order, all or part. */
export function FulfilPage() {
  const { id = '' } = useParams();
  const { fulfil } = useOrderRights();
  const order = useOrder(id);
  if (!fulfil) return <Navigate to={`/orders/${id}`} replace />;
  if (order.isPending) return <Skeleton className="h-64 w-full" />;
  if (order.error) return <ErrorMessage error={order.error} />;
  if (order.data.status !== 'CONFIRMED' && order.data.status !== 'PARTIAL') {
    return <Navigate to={`/orders/${id}`} replace />;
  }
  return <FulfilForm order={order.data} />;
}

/**
 * One field per open line, filled with what is proposed: on a purchase what is left to receive,
 * on a sale what is reserved for it (the goods surely there). The person changes what arrives or
 * leaves; zero leaves a line out. The warehouse checks the stock and its errors come back here.
 */
function FulfilForm({ order }: { order: Order }) {
  const { t, i18n } = useTranslation('orders');
  const { t: tc } = useTranslation();
  const { t: tError } = useTranslation('errors');
  const language = i18n.language;
  const navigate = useNavigate();
  const quantity = useQuantity();
  const phone = useBreakpoint() === 'phone';
  const post = useFulfil(order.id);
  // Chosen once, when the page opens: sending it again records nothing new (B33).
  const [id] = useState(() => uuidv7());
  const sales = order.kind === 'SALES';
  const open = order.lines.filter((line) => line.remainingQuantity !== '0.000');
  const proposed = (line: (typeof open)[number]) =>
    sales && line.reservedQuantity !== line.remainingQuantity
      ? line.reservedQuantity
      : line.remainingQuantity;
  const [values, setValues] = useState(() =>
    open.map((line) => decimalToInput(proposed(line), language, 0)),
  );
  const [documentDate, setDocumentDate] = useState(businessToday());
  const [ref, setRef] = useState('');
  const [refDate, setRefDate] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setAll = (pick: (line: (typeof open)[number]) => string) =>
    setValues(open.map((line) => decimalToInput(pick(line), language, 0)));

  const submit = () => {
    const found: Record<string, string> = {};
    const lines = open.map((line, index) => {
      const parsed = parseDecimalInput(
        values[index] ?? '',
        language,
        quantityLimits(line.unitDecimals),
      );
      if (parsed === undefined) found[`lines.${index}`] = 'validation.quantity';
      return { orderLineId: line.id, quantity: parsed ?? '0' };
    });
    if (lines.every((line) => /^0+(\.0+)?$/.test(line.quantity))) found.lines = 'NOTHING_TO_FULFIL';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    post.mutate(
      {
        id,
        documentDate,
        partyDocumentRef: ref.trim() || null,
        partyDocumentDate: refDate || null,
        notes: notes.trim() || null,
        lines,
      },
      {
        onSuccess: () => navigate(`/orders/${order.id}`, { replace: true }),
        onError: (error) => {
          if (!(error instanceof ApiError)) return;
          const fromServer: Record<string, string> = {};
          for (const { field, code } of error.problem?.errors ?? []) {
            const match = /^lines\[(\d+)\]/.exec(field);
            fromServer[match ? `lines.${match[1]}` : field] = `validation.${code}`;
          }
          setErrors(fromServer);
        },
      },
    );
  };

  const stockProblem =
    post.error instanceof ApiError &&
    ['STOCK_INSUFFICIENT', 'NOTHING_TO_FULFIL', 'ORDER_NOT_OPEN'].includes(
      post.error.problem?.code ?? '',
    );
  const fieldErrorsOnly =
    post.error instanceof ApiError && Boolean(post.error.problem?.errors?.length);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(`fulfil.title.${order.kind}`, { reference: order.reference })}
        description={`${order.partyName} · ${order.warehouseCode ?? ''}`}
      />
      {post.error && !fieldErrorsOnly && !stockProblem && <ErrorMessage error={post.error} />}
      {(stockProblem || errors.lines) && (
        <Alert variant="warning">
          {tError(
            ((post.error instanceof ApiError && post.error.problem?.code) ||
              'NOTHING_TO_FULFIL') as 'NOTHING_TO_FULFIL',
          )}
        </Alert>
      )}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-6"
      >
        <fieldset className="border-border flex flex-col gap-3 border-t pt-4">
          <legend className="text-sm font-medium">{t('form.section.lines')}</legend>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAll((l) => l.remainingQuantity)}
            >
              {t('fulfil.all')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setAll(() => '0')}>
              {t('fulfil.none')}
            </Button>
          </div>
          <ol className="flex flex-col gap-3">
            {open.map((line, index) => (
              <li
                key={line.id}
                className="border-border bg-card grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_10rem] md:items-end md:border-0 md:bg-transparent md:p-0"
              >
                <div className="flex flex-col gap-0.5 text-sm">
                  <span>
                    <span className="font-mono">{line.itemCode}</span> {line.description}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {t('fulfil.remaining', {
                      quantity: `${quantity(line.remainingQuantity, line.unitDecimals)} ${line.unit}`,
                    })}
                    {sales &&
                      ` · ${t('fulfil.reserved', {
                        quantity: quantity(line.reservedQuantity, line.unitDecimals),
                      })}`}
                    {sales &&
                      line.availableQuantity !== null &&
                      ` · ${t('form.lines.available', {
                        quantity: quantity(line.availableQuantity, line.unitDecimals),
                      })}`}
                  </span>
                </div>
                <FormField
                  label={`${t(`fulfil.quantity.${order.kind}`)} (${line.unit})`}
                  error={
                    errors[`lines.${index}`] ? tError(errors[`lines.${index}`] as never) : undefined
                  }
                >
                  {(p) => (
                    <DecimalInput
                      {...p}
                      value={values[index] ?? ''}
                      onChange={(event) =>
                        setValues((current) =>
                          current.map((v, i) => (i === index ? event.target.value : v)),
                        )
                      }
                    />
                  )}
                </FormField>
              </li>
            ))}
          </ol>
        </fieldset>

        <fieldset className="border-border grid gap-4 border-t pt-4 sm:grid-cols-2">
          <legend className="sr-only">{t('fulfil.document')}</legend>
          <FormField
            label={t('fulfil.date')}
            error={errors.documentDate ? tError(errors.documentDate as never) : undefined}
          >
            {(p) => (
              <Input
                type="date"
                max={businessToday()}
                {...p}
                value={documentDate}
                onChange={(e) => setDocumentDate(e.target.value)}
              />
            )}
          </FormField>
          {!sales && (
            <>
              <FormField
                label={t('fulfil.ref')}
                error={
                  errors.partyDocumentRef ? tError(errors.partyDocumentRef as never) : undefined
                }
              >
                {(p) => (
                  <Input
                    autoComplete="off"
                    {...p}
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                  />
                )}
              </FormField>
              <FormField
                label={t('fulfil.refDate')}
                error={
                  errors.partyDocumentDate ? tError(errors.partyDocumentDate as never) : undefined
                }
              >
                {(p) => (
                  <Input
                    type="date"
                    {...p}
                    value={refDate}
                    onChange={(e) => setRefDate(e.target.value)}
                  />
                )}
              </FormField>
            </>
          )}
          <div className="sm:col-span-2">
            <FormField label={t('form.fields.notes')}>
              {(p) => (
                <Textarea
                  rows={2}
                  {...p}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        <div
          className={
            phone
              ? 'border-border bg-card sticky bottom-0 -mx-4 flex gap-3 border-t px-4 pt-3 pb-4'
              : 'border-border flex justify-end gap-3 border-t pt-4'
          }
        >
          <Button
            type="button"
            variant="outline"
            className={phone ? 'flex-1' : undefined}
            onClick={() => void navigate(`/orders/${order.id}`)}
          >
            {tc('actions.cancel')}
          </Button>
          <Button type="submit" className={phone ? 'flex-2' : undefined} disabled={post.isPending}>
            {post.isPending ? t('fulfil.posting') : t(`fulfil.post.${order.kind}`)}
          </Button>
        </div>
      </form>
    </div>
  );
}
