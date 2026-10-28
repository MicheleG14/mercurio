import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { Controller, type UseFormReturn, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { LinesEditor } from '@/components/shared/LinesEditor';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchCombobox } from '@/components/shared/SearchCombobox';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesGuard';
import { useUnsavedChanges } from '@/components/shared/useUnsavedChanges';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { parseDecimalInput, quantityLimits, subtractQuantities } from '@/lib/decimal';
import { businessToday } from '@/lib/format';
import { useBreakpoint } from '@/lib/breakpoint';
import { uuidv7 } from '@/lib/uuid';
import {
  type DocumentValues,
  documentBody,
  documentSchema,
  emptyDocument,
  emptyLine,
  formPath,
  isDocumentType,
  REASONS,
  reasonsOf,
} from './document-form';
import { useQuantity, useWarehouseRights } from './hooks';
import { NoWarehouses, WarehouseSelect } from './parts';
import {
  type DocumentType,
  type ItemOption,
  type PartyOption,
  useItemSearch,
  useItemStock,
  usePartySearch,
  usePostDocument,
  useWarehouses,
} from './queries';

/** `/stock/documents/new?type=receipt|issue|adjustment|transfer`: recording a stock document. */
export function NewDocumentPage() {
  const [params] = useSearchParams();
  const type = params.get('type');
  const { write } = useWarehouseRights();
  const warehouses = useWarehouses();

  if (!write) return <Navigate to="/stock/documents" replace />;
  if (!isDocumentType(type)) return <Navigate to="/stock/documents/new?type=receipt" replace />;
  if (warehouses.isPending) return <Skeleton className="h-64 w-full" />;
  if (warehouses.error) return <ErrorMessage error={warehouses.error} />;
  if (warehouses.data.items.length === 0) return <NoWarehouses />;
  // A new form for each type, so switching type starts clean.
  return <DocumentForm key={type} type={type} />;
}

function DocumentForm({ type }: { type: DocumentType }) {
  const { t, i18n } = useTranslation('warehouse');
  const { t: tc } = useTranslation();
  const { t: tError } = useTranslation('errors');
  const language = i18n.language;
  const navigate = useNavigate();
  const phone = useBreakpoint() === 'phone';
  const warehouses = useWarehouses().data?.items ?? [];
  const post = usePostDocument();
  // Chosen once, when the form opens: sending it again records nothing new (B33).
  const [id] = useState(() => uuidv7());

  const reasons = reasonsOf(type);
  const schema = useMemo(() => documentSchema(language), [language]);
  const form = useForm<DocumentValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyDocument(reasons[0]!, businessToday(), warehouses[0]?.id ?? ''),
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const [reason, warehouseId] = useWatch({
    control: form.control,
    name: ['reason', 'warehouseId'],
  });
  const rule = REASONS[reason];
  const { errors, isDirty } = form.formState;
  const { blocker, leave } = useUnsavedChanges(isDirty);
  const msg = (key?: string) => (key ? tError(key as never) : undefined);

  // A party chosen for one reason may have the wrong role for another.
  useEffect(() => {
    form.setValue('party', null);
  }, [reason, form]);

  const onSubmit = form.handleSubmit((values) => {
    post.mutate(documentBody(values, language, id), {
      onSuccess: (document) =>
        leave(() => navigate(`/stock/documents/${document.id}`, { replace: true })),
      onError: (error) => {
        if (!(error instanceof ApiError)) return;
        for (const { field, code } of error.problem?.errors ?? []) {
          form.setError(formPath(field) as never, { message: `validation.${code}` });
        }
      },
    });
  });

  const counted = type === 'adjustment';
  const fieldErrorsOnly =
    post.error instanceof ApiError && Boolean(post.error.problem?.errors?.length);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t(`document.newTitle.${type}`)} description={t('document.immutable')} />
      {post.error && !fieldErrorsOnly && <ErrorMessage error={post.error} />}
      {post.error instanceof ApiError &&
        (post.error.problem?.code === 'STOCK_INSUFFICIENT' ||
          post.error.problem?.code === 'STOCK_RESERVED') && (
          <Alert variant="warning">{tError(post.error.problem.code)}</Alert>
        )}

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <fieldset className="border-border grid gap-4 border-t pt-4 md:grid-cols-[12rem_1fr]">
          <legend className="sr-only">{t('document.section.header')}</legend>
          <h2 aria-hidden="true" className="text-sm font-medium">
            {t('document.section.header')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {reasons.length > 1 && (
              <FormField label={t('document.fields.reason')}>
                {(p) => (
                  <NativeSelect className="w-full" {...p} {...form.register('reason')}>
                    {reasons.map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {t(`reason.${value}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            )}
            <FormField
              label={t('document.fields.date')}
              hint={t('document.hint.date')}
              error={msg(errors.documentDate?.message)}
            >
              {(p) => (
                <Input
                  type="date"
                  max={businessToday()}
                  {...p}
                  {...form.register('documentDate')}
                />
              )}
            </FormField>
            <Controller
              control={form.control}
              name="warehouseId"
              render={({ field }) => (
                <FormField
                  label={t(
                    type === 'transfer' ? 'document.fields.source' : 'document.fields.warehouse',
                  )}
                  error={msg(errors.warehouseId?.message)}
                >
                  {(p) => (
                    <WarehouseSelect
                      {...p}
                      warehouses={warehouses}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                </FormField>
              )}
            />
            {type === 'transfer' && (
              <Controller
                control={form.control}
                name="targetWarehouseId"
                render={({ field }) => (
                  <FormField
                    label={t('document.fields.target')}
                    error={msg(errors.targetWarehouseId?.message)}
                  >
                    {(p) => (
                      <NativeSelect
                        className="w-full"
                        {...p}
                        value={field.value}
                        onChange={(event) => field.onChange(event.target.value)}
                      >
                        <NativeSelectOption value="">—</NativeSelectOption>
                        {warehouses
                          .filter((w) => w.id !== warehouseId)
                          .map((w) => (
                            <NativeSelectOption key={w.id} value={w.id}>
                              {w.code} · {w.name}
                            </NativeSelectOption>
                          ))}
                      </NativeSelect>
                    )}
                  </FormField>
                )}
              />
            )}
          </div>
        </fieldset>

        {rule.party && <PartySection role={rule.party} required={rule.partyRequired} form={form} />}

        <LinesEditor
          legend={t('document.section.lines')}
          hint={counted ? t('document.hint.counted') : undefined}
          error={msg(errors.lines?.message)}
          keys={lines.fields.map((line) => line.id)}
          columns="md:grid-cols-[1fr_10rem_auto]"
          renderLine={(index) => (
            <LineFields index={index} form={form} warehouseId={warehouseId} counted={counted} />
          )}
          renderAside={(index) => (
            <LineAside index={index} form={form} warehouseId={warehouseId} counted={counted} />
          )}
          addLabel={t('document.lines.add')}
          onAdd={() => lines.append(emptyLine())}
          removeLabel={(n) => t('document.lines.remove', { n })}
          onRemove={(index) => lines.remove(index)}
        />

        <fieldset className="border-border grid gap-4 border-t pt-4 md:grid-cols-[12rem_1fr]">
          <legend className="sr-only">{t('document.section.notes')}</legend>
          <h2 aria-hidden="true" className="text-sm font-medium">
            {t('document.section.notes')}
          </h2>
          <FormField
            label={t('document.fields.notes')}
            hint={reason === 'LOSS' ? t('document.hint.notes') : undefined}
            error={msg(errors.notes?.message)}
          >
            {(p) => <Textarea rows={2} {...p} {...form.register('notes')} />}
          </FormField>
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
            onClick={() => void navigate('/stock/documents')}
          >
            {tc('actions.cancel')}
          </Button>
          <Button type="submit" className={phone ? 'flex-2' : undefined} disabled={post.isPending}>
            {post.isPending ? t('document.posting') : t('document.post')}
          </Button>
        </div>
      </form>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}

type Form = UseFormReturn<DocumentValues>;

/** Supplier or customer, with the number and date of their delivery note. */
function PartySection({
  role,
  required,
  form,
}: {
  role: 'supplier' | 'customer';
  required: boolean;
  form: Form;
}) {
  const { t } = useTranslation('warehouse');
  const { t: tError } = useTranslation('errors');
  const parties = usePartySearch(role);
  const errors = form.formState.errors;
  const msg = (key?: string) => (key ? tError(key as never) : undefined);

  return (
    <fieldset className="border-border grid gap-4 border-t pt-4 md:grid-cols-[12rem_1fr]">
      <legend className="sr-only">{t('document.section.party')}</legend>
      <h2 aria-hidden="true" className="text-sm font-medium">
        {t('document.section.party')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Controller
            control={form.control}
            name="party"
            render={({ field }) => (
              <FormField
                label={t(
                  role === 'supplier' ? 'document.fields.supplier' : 'document.fields.customer',
                )}
                hint={required ? undefined : t('document.hint.partyOptional')}
                error={msg(errors.party?.message)}
              >
                {(p) => (
                  <SearchCombobox<PartyOption>
                    {...p}
                    value={field.value}
                    onChange={field.onChange}
                    queryKey={parties.queryKey}
                    search={parties.search}
                    itemKey={(party) => party.id}
                    itemLabel={(party) => party.name}
                    itemDetail={(party) => party.vatNumber}
                    placeholder={t('document.lines.searchParty')}
                  />
                )}
              </FormField>
            )}
          />
        </div>
        <FormField
          label={t('document.fields.partyDocumentRef')}
          hint={t('document.hint.partyDocumentRef')}
          error={msg(errors.partyDocumentRef?.message)}
        >
          {(p) => <Input autoComplete="off" {...p} {...form.register('partyDocumentRef')} />}
        </FormField>
        <FormField
          label={t('document.fields.partyDocumentDate')}
          error={msg(errors.partyDocumentDate?.message)}
        >
          {(p) => <Input type="date" {...p} {...form.register('partyDocumentDate')} />}
        </FormField>
      </div>
    </fieldset>
  );
}

/**
 * The fields of one line: the item (searched, with its stock in the warehouse) and the quantity,
 * or what was counted. LinesEditor lays them out, a grid row or a card.
 */
function LineFields({
  index,
  form,
  warehouseId,
  counted,
}: {
  index: number;
  form: Form;
  warehouseId: string;
  counted: boolean;
}) {
  const { t } = useTranslation('warehouse');
  const { t: tError } = useTranslation('errors');
  const quantity = useQuantity();
  const items = useItemSearch(warehouseId || undefined);
  const item = useWatch({ control: form.control, name: `lines.${index}.item` });
  const lineErrors = form.formState.errors.lines?.[index];
  const msg = (key?: string) => (key ? tError(key as never) : undefined);
  const n = index + 1;
  const amount = (value: string, option: ItemOption) =>
    `${quantity(value, option.unitDecimals)} ${option.unit}`;

  return (
    <>
      <Controller
        control={form.control}
        name={`lines.${index}.item`}
        render={({ field }) => (
          <FormField
            label={`${t('document.lines.line', { n })} · ${t('document.lines.item')}`}
            error={msg(lineErrors?.item?.message)}
          >
            {(p) => (
              <SearchCombobox<ItemOption>
                {...p}
                value={field.value}
                onChange={field.onChange}
                queryKey={items.queryKey}
                search={items.search}
                itemKey={(option) => option.id}
                itemLabel={(option) => `${option.code} · ${option.description}`}
                itemDetail={(option) =>
                  option.quantity === null
                    ? option.unit
                    : [
                        t('document.lines.stock', { quantity: amount(option.quantity, option) }),
                        option.availableQuantity !== null &&
                        option.availableQuantity !== option.quantity
                          ? t('document.lines.available', {
                              quantity: amount(option.availableQuantity, option),
                            })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                }
                placeholder={t('document.lines.searchItem')}
              />
            )}
          </FormField>
        )}
      />
      <FormField
        label={`${t(counted ? 'document.lines.counted' : 'document.lines.quantity')}${item ? ` (${item.unit})` : ''}`}
        error={msg(lineErrors?.quantity?.message)}
      >
        {(p) => <DecimalInput {...p} {...form.register(`lines.${index}.quantity`)} />}
      </FormField>
    </>
  );
}

/** Next to a line: the item's stock in the warehouse, once an item is chosen. */
function LineAside({
  index,
  form,
  warehouseId,
  counted,
}: {
  index: number;
  form: Form;
  warehouseId: string;
  counted: boolean;
}) {
  const item = useWatch({ control: form.control, name: `lines.${index}.item` });
  const typed = useWatch({ control: form.control, name: `lines.${index}.quantity` });
  if (!item || !warehouseId) return null;
  return (
    <LineStock
      itemId={item.id}
      warehouseId={warehouseId}
      decimals={item.unitDecimals}
      unit={item.unit}
      counted={counted ? typed : undefined}
    />
  );
}

/** The item's stock in the warehouse now; for a count, the difference the count will make. */
function LineStock({
  itemId,
  warehouseId,
  decimals,
  unit,
  counted,
}: {
  itemId: string;
  warehouseId: string;
  decimals: number;
  unit: string;
  counted?: string;
}) {
  const { t, i18n } = useTranslation('warehouse');
  const quantity = useQuantity();
  const stock = useItemStock(itemId).data;
  const row = stock?.warehouses.find((w) => w.warehouseId === warehouseId);
  const current = row?.quantity ?? '0';
  if (!stock) return null;
  const parsed =
    counted === undefined
      ? undefined
      : parseDecimalInput(counted, i18n.language, quantityLimits(decimals));
  const difference = parsed ? subtractQuantities(parsed, current) : null;

  return (
    <span className="text-muted-foreground text-sm tabular-nums md:text-right">
      {t('document.lines.stock', { quantity: `${quantity(current, decimals)} ${unit}` })}
      {row && row.reservedQuantity !== '0.000' && (
        // Part of it is promised to orders: what a free issue may take is less.
        <span className="block">
          {t('document.lines.available', {
            quantity: `${quantity(row.availableQuantity, decimals)} ${unit}`,
          })}
        </span>
      )}
      {difference !== null && (
        <span className="text-foreground block font-medium">
          {t('document.lines.difference')}: {difference.startsWith('-') ? '' : '+'}
          {quantity(difference, decimals)}
        </span>
      )}
    </span>
  );
}
