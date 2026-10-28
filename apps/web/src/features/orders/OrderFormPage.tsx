import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, type UseFormReturn, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { LinesEditor } from '@/components/shared/LinesEditor';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchCombobox } from '@/components/shared/SearchCombobox';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesGuard';
import { useUnsavedChanges } from '@/components/shared/useUnsavedChanges';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useBreakpoint } from '@/lib/breakpoint';
import { decimalToInput } from '@/lib/decimal';
import { businessToday } from '@/lib/format';
import { uuidv7 } from '@/lib/uuid';
import { useOrderRights, useQuantity } from './hooks';
import {
  confirmIssues,
  emptyOrder,
  emptyOrderLine,
  formPath,
  orderBody,
  orderSchema,
  type OrderValues,
  previewAmount,
  previewTotals,
  valuesOf,
} from './order-form';
import { OrderTotals } from './parts';
import {
  type Order,
  type OrderItemOption,
  type OrderKind,
  type OrderPartyOption,
  type ProposalLine,
  useOrder,
  useOrderAction,
  useOrderItemSearch,
  useOrderPartySearch,
  useOrderWarehouses,
  useReorderProposal,
  useSaveOrder,
  useVatCodes,
} from './queries';

const isKind = (value: string | null): value is OrderKind =>
  value === 'SALES' || value === 'PURCHASE';

/**
 * `/orders/new?kind=SALES|PURCHASE` (with `&proposal=<warehouse>` from "Order from suppliers")
 * and `/orders/:id/edit`: a draft, written and saved, then confirmed.
 */
export function OrderFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { write } = useOrderRights();
  const kind = params.get('kind');
  const proposalWarehouse = params.get('proposal');
  const existing = useOrder(id ?? '');
  const warehouses = useOrderWarehouses();
  const vatCodes = useVatCodes();
  const proposal = useReorderProposal(id ? null : proposalWarehouse);

  if (!write) return <Navigate to="/" replace />;
  if (!id && !isKind(kind)) return <Navigate to="/orders/new?kind=SALES" replace />;
  if (id && existing.error) return <ErrorMessage error={existing.error} />;
  if (warehouses.error) return <ErrorMessage error={warehouses.error} />;
  if (
    (id && existing.isPending) ||
    warehouses.isPending ||
    vatCodes.isPending ||
    (proposalWarehouse && !id && proposal.isPending)
  ) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (id && existing.data && existing.data.status !== 'DRAFT') {
    return <Navigate to={`/orders/${id}`} replace />;
  }
  return (
    <OrderForm
      key={id ?? `new-${kind}`}
      kind={existing.data?.kind ?? (kind as OrderKind)}
      order={existing.data}
      proposal={
        proposalWarehouse
          ? { warehouseId: proposalWarehouse, lines: proposal.data ?? [] }
          : undefined
      }
    />
  );
}

function OrderForm({
  kind,
  order,
  proposal,
}: {
  kind: OrderKind;
  order?: Order;
  proposal?: { warehouseId: string; lines: ProposalLine[] };
}) {
  const { t, i18n } = useTranslation('orders');
  const { t: tc } = useTranslation();
  const { t: tError } = useTranslation('errors');
  const language = i18n.language;
  const navigate = useNavigate();
  const phone = useBreakpoint() === 'phone';
  const warehouses = useOrderWarehouses().data?.items ?? [];
  const vatCodes = useVatCodes().data ?? [];
  const save = useSaveOrder();
  // Chosen once, when the form opens: saving twice is the same draft (B33).
  const [id] = useState(() => order?.id ?? uuidv7());
  const [version, setVersion] = useState(order?.version);
  const confirm = useOrderAction(id);

  // Filled once, when the form opens.
  const [defaults] = useState(() => {
    if (order) return valuesOf(order, language);
    const values = emptyOrder(businessToday(), proposal?.warehouseId ?? warehouses[0]?.id ?? '');
    if (proposal && proposal.lines.length > 0) {
      values.lines = proposal.lines.map((line) => ({
        item: {
          id: line.itemId,
          code: line.itemCode,
          description: line.description,
          unit: line.unit,
          unitDecimals: line.unitDecimals,
          salePrice: null,
          vatCode: line.vatCode,
          availableQuantity: line.availableQuantity,
        },
        quantity: decimalToInput(line.proposedQuantity, language, 0),
        unitPrice: '',
        discountPercent: '',
        vatCode: line.vatCode,
      }));
    }
    return values;
  });
  const schema = useMemo(() => orderSchema(language), [language]);
  const form = useForm<OrderValues>({ resolver: zodResolver(schema), defaultValues: defaults });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const [warehouseId, typedLines] = useWatch({
    control: form.control,
    name: ['warehouseId', 'lines'],
  });
  const totals = previewTotals(typedLines ?? [], vatCodes, language);
  const { errors, isDirty } = form.formState;
  const { blocker, leave } = useUnsavedChanges(isDirty);
  const msg = (key?: string) => (key ? tError(key as never) : undefined);

  const showServerErrors = (error: unknown) => {
    if (!(error instanceof ApiError)) return;
    for (const { field, code } of error.problem?.errors ?? []) {
      form.setError(formPath(field) as never, { message: `validation.${code}` });
    }
  };

  /** Saves the draft and, with `andConfirm`, confirms it; then opens the order. */
  const submit = (andConfirm: boolean) =>
    void form.handleSubmit(async (values) => {
      const issues = andConfirm ? confirmIssues(values, kind) : [];
      for (const [field, message] of issues) form.setError(field as never, { message });
      if (issues.length > 0) return;
      try {
        const saved = await save.mutateAsync({
          body: orderBody(values, language, id, kind),
          version,
        });
        setVersion(saved.version);
        form.reset(values);
        if (andConfirm) await confirm.mutateAsync({ type: 'confirm', version: saved.version });
        leave(() => navigate(`/orders/${id}`, { replace: true }));
      } catch (error) {
        showServerErrors(error);
      }
    })();

  const failure = save.error ?? confirm.error;
  const fieldErrorsOnly = failure instanceof ApiError && Boolean(failure.problem?.errors?.length);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={order ? t('form.editTitle') : t(`form.newTitle.${kind}`)}
        description={t('form.description')}
      />
      {failure && !fieldErrorsOnly && <ErrorMessage error={failure} />}

      <form noValidate onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-6">
        <fieldset className="border-border grid gap-4 border-t pt-4 md:grid-cols-[12rem_1fr]">
          <legend className="sr-only">{t('form.section.header')}</legend>
          <h2 aria-hidden="true" className="text-sm font-medium">
            {t('form.section.header')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <PartyField kind={kind} form={form} />
            </div>
            <Controller
              control={form.control}
              name="warehouseId"
              render={({ field }) => (
                <FormField
                  label={t(`form.fields.warehouse.${kind}`)}
                  hint={t('form.hint.warehouse')}
                  error={msg(errors.warehouseId?.message)}
                >
                  {(p) => (
                    <NativeSelect
                      className="w-full"
                      {...p}
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.value)}
                    >
                      <NativeSelectOption value="">—</NativeSelectOption>
                      {warehouses.map((w) => (
                        <NativeSelectOption key={w.id} value={w.id}>
                          {w.code} · {w.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              )}
            />
            <FormField label={t('form.fields.orderDate')} error={msg(errors.orderDate?.message)}>
              {(p) => (
                <Input type="date" max={businessToday()} {...p} {...form.register('orderDate')} />
              )}
            </FormField>
            <FormField
              label={t('form.fields.requestedDate')}
              error={msg(errors.requestedDate?.message)}
            >
              {(p) => <Input type="date" {...p} {...form.register('requestedDate')} />}
            </FormField>
            <FormField
              label={t(`form.fields.partyReference.${kind}`)}
              error={msg(errors.partyReference?.message)}
            >
              {(p) => <Input autoComplete="off" {...p} {...form.register('partyReference')} />}
            </FormField>
            <FormField
              label={t('form.fields.partyReferenceDate')}
              error={msg(errors.partyReferenceDate?.message)}
            >
              {(p) => <Input type="date" {...p} {...form.register('partyReferenceDate')} />}
            </FormField>
          </div>
        </fieldset>

        <LinesEditor
          legend={t('form.section.lines')}
          error={msg(errors.lines?.message)}
          keys={lines.fields.map((line) => line.id)}
          columns="md:grid-cols-[minmax(12rem,1fr)_7rem_8rem_5rem_8rem_auto]"
          minLines={0}
          renderLine={(index) => (
            <LineFields index={index} form={form} kind={kind} warehouseId={warehouseId} />
          )}
          renderAside={(index) => <LineAside index={index} form={form} kind={kind} />}
          addLabel={t('form.lines.add')}
          onAdd={() => lines.append(emptyOrderLine())}
          removeLabel={(n) => t('form.lines.remove', { n })}
          onRemove={(index) => lines.remove(index)}
        />

        <OrderTotals {...totals} />

        <fieldset className="border-border grid gap-4 border-t pt-4 md:grid-cols-[12rem_1fr]">
          <legend className="sr-only">{t('form.section.notes')}</legend>
          <h2 aria-hidden="true" className="text-sm font-medium">
            {t('form.section.notes')}
          </h2>
          <FormField label={t('form.fields.notes')} error={msg(errors.notes?.message)}>
            {(p) => <Textarea rows={2} {...p} {...form.register('notes')} />}
          </FormField>
        </fieldset>

        <div
          className={
            phone
              ? 'border-border bg-card sticky bottom-0 -mx-4 flex flex-wrap gap-3 border-t px-4 pt-3 pb-4'
              : 'border-border flex justify-end gap-3 border-t pt-4'
          }
        >
          <Button
            type="button"
            variant="outline"
            className={phone ? 'flex-1' : undefined}
            onClick={() =>
              void navigate(
                order
                  ? `/orders/${order.id}`
                  : `/orders/${kind === 'SALES' ? 'sales' : 'purchase'}`,
              )
            }
          >
            {tc('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={phone ? 'flex-1' : undefined}
            disabled={save.isPending || confirm.isPending}
            onClick={() => submit(false)}
          >
            {t('form.saveDraft')}
          </Button>
          <Button
            type="button"
            className={phone ? 'w-full' : undefined}
            disabled={save.isPending || confirm.isPending}
            onClick={() => submit(true)}
          >
            {confirm.isPending ? t('form.confirming') : t('form.saveAndConfirm')}
          </Button>
        </div>
      </form>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}

type Form = UseFormReturn<OrderValues>;

/** The supplier or the customer, searched among the active ones with that role. */
function PartyField({ kind, form }: { kind: OrderKind; form: Form }) {
  const { t } = useTranslation('orders');
  const { t: tError } = useTranslation('errors');
  const parties = useOrderPartySearch(kind);
  const error = form.formState.errors.party?.message;
  return (
    <Controller
      control={form.control}
      name="party"
      render={({ field }) => (
        <FormField
          label={t(`form.fields.party.${kind}`)}
          error={error ? tError(error as never) : undefined}
        >
          {(p) => (
            <SearchCombobox<OrderPartyOption>
              {...p}
              value={field.value}
              onChange={field.onChange}
              queryKey={parties.queryKey}
              search={parties.search}
              itemKey={(party) => party.id}
              itemLabel={(party) => party.name}
              itemDetail={(party) => party.vatNumber}
              placeholder={t('form.searchParty')}
            />
          )}
        </FormField>
      )}
    />
  );
}

/**
 * The fields of one line: item, quantity, unit price, discount, VAT. Choosing an item proposes its
 * list price (on a sale) and its VAT code; both stay editable.
 */
function LineFields({
  index,
  form,
  kind,
  warehouseId,
}: {
  index: number;
  form: Form;
  kind: OrderKind;
  warehouseId: string;
}) {
  const { t, i18n } = useTranslation('orders');
  const { t: tError } = useTranslation('errors');
  const { t: tRegistry } = useTranslation('registry');
  const quantity = useQuantity();
  const items = useOrderItemSearch(warehouseId || undefined);
  const vatCodes = useVatCodes().data ?? [];
  const item = useWatch({ control: form.control, name: `lines.${index}.item` });
  const lineErrors = form.formState.errors.lines?.[index];
  const msg = (key?: string) => (key ? tError(key as never) : undefined);
  const n = index + 1;

  return (
    <>
      <Controller
        control={form.control}
        name={`lines.${index}.item`}
        render={({ field }) => (
          <FormField
            label={`${t('form.lines.line', { n })} · ${t('form.lines.item')}`}
            error={msg(lineErrors?.item?.message)}
          >
            {(p) => (
              <SearchCombobox<OrderItemOption>
                {...p}
                value={field.value}
                onChange={(option) => {
                  field.onChange(option);
                  if (!option) return;
                  form.setValue(`lines.${index}.vatCode`, option.vatCode);
                  if (
                    kind === 'SALES' &&
                    option.salePrice &&
                    !form.getValues(`lines.${index}.unitPrice`)
                  ) {
                    form.setValue(
                      `lines.${index}.unitPrice`,
                      decimalToInput(option.salePrice, i18n.language),
                    );
                  }
                }}
                queryKey={items.queryKey}
                search={items.search}
                itemKey={(option) => option.id}
                itemLabel={(option) => `${option.code} · ${option.description}`}
                itemDetail={(option) =>
                  option.availableQuantity === null
                    ? option.unit
                    : t('form.lines.available', {
                        quantity: `${quantity(option.availableQuantity, option.unitDecimals)} ${option.unit}`,
                      })
                }
                placeholder={t('form.lines.searchItem')}
              />
            )}
          </FormField>
        )}
      />
      <FormField
        label={`${t('form.lines.quantity')}${item ? ` (${item.unit})` : ''}`}
        error={msg(lineErrors?.quantity?.message)}
      >
        {(p) => <DecimalInput {...p} {...form.register(`lines.${index}.quantity`)} />}
      </FormField>
      <FormField label={t('form.lines.unitPrice')} error={msg(lineErrors?.unitPrice?.message)}>
        {(p) => <DecimalInput {...p} {...form.register(`lines.${index}.unitPrice`)} />}
      </FormField>
      <FormField label={t('form.lines.discount')} error={msg(lineErrors?.discountPercent?.message)}>
        {(p) => <DecimalInput {...p} {...form.register(`lines.${index}.discountPercent`)} />}
      </FormField>
      <FormField label={t('form.lines.vat')} error={msg(lineErrors?.vatCode?.message)}>
        {(p) => (
          <NativeSelect className="w-full" {...p} {...form.register(`lines.${index}.vatCode`)}>
            <NativeSelectOption value="">—</NativeSelectOption>
            {vatCodes.map((vat) => (
              <NativeSelectOption key={vat.code} value={vat.code}>
                {vat.nature
                  ? `${vat.nature} · ${tRegistry(`vat.nature.${vat.nature.replace('.', '_') as 'N1'}`)}`
                  : tRegistry('vat.rate', { rate: vat.code })}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
    </>
  );
}

/** Next to a line: its amount as typed, and on a sale the free stock of the item. */
function LineAside({ index, form, kind }: { index: number; form: Form; kind: OrderKind }) {
  const { t, i18n } = useTranslation('orders');
  const quantity = useQuantity();
  const line = useWatch({ control: form.control, name: `lines.${index}` });
  if (!line?.item) return null;
  const amount = previewAmount(line, i18n.language);
  return (
    <span className="text-muted-foreground flex flex-col text-sm md:text-right">
      {amount !== null && <MoneyAmount value={amount} className="text-foreground font-medium" />}
      {kind === 'SALES' && line.item.availableQuantity !== null && (
        <span className="tabular-nums">
          {t('form.lines.available', {
            quantity: `${quantity(line.item.availableQuantity, line.item.unitDecimals)} ${line.item.unit}`,
          })}
        </span>
      )}
    </span>
  );
}
