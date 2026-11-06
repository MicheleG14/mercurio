import { FileDownIcon, TrashIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Controller, type UseFormReturn, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
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
import { decimalToInput, formatMoney } from '@/lib/decimal';
import { businessToday, formatDate } from '@/lib/format';
import { uuidv7 } from '@/lib/uuid';
import {
  draftBody,
  type DraftValues,
  emptyLine,
  formIssues,
  formPath,
  previewAmount,
  previewTotals,
  valuesOf,
} from './draft-form';
import { useInvoicingRights, usePaymentTermsLabel, useVatLabel } from './hooks';
import { DocumentTotals } from './parts';
import {
  type CustomerOption,
  type InvoiceDraft,
  type InvoiceItemOption,
  useCompany,
  useCreateDraft,
  useCustomerSearch,
  useDeleteDraft,
  useDraft,
  useInvoiceItemSearch,
  useIssue,
  usePdf,
  useReferenceData,
  useSaveDraft,
} from './queries';

/**
 * `/invoicing/new` (with `?fulfilments=a,b` from an order): makes an empty draft, or one with
 * those shipments, and opens it. The id is chosen once, so a reload makes no second draft (B33).
 */
export function NewDraftPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation('invoicing');
  const create = useCreateDraft();
  const [id] = useState(() => uuidv7());
  const started = useRef(false);
  const fulfilmentIds = (params.get('fulfilments') ?? '').split(',').filter(Boolean);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    create.mutate(
      { id, ...(fulfilmentIds.length > 0 ? { fulfilmentIds } : {}) },
      { onSuccess: (draft) => void navigate(`/invoicing/drafts/${draft.id}`, { replace: true }) },
    );
  });

  if (create.error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('editor.newTitle')} />
        <ErrorMessage error={create.error} />
      </div>
    );
  }
  return <Skeleton className="h-64 w-full" />;
}

/** `/invoicing/drafts/:id`: a draft written, saved, previewed and issued. */
export function DraftPage() {
  const { id = '' } = useParams();
  const { write } = useInvoicingRights();
  const draft = useDraft(id);
  const reference = useReferenceData();
  if (!write) return <Navigate to="/invoicing/invoices" replace />;
  if (draft.error) return <ErrorMessage error={draft.error} />;
  if (draft.isPending || reference.isPending) return <Skeleton className="h-64 w-full" />;
  return <DraftForm key={draft.data.id} draft={draft.data} />;
}

function DraftForm({ draft }: { draft: InvoiceDraft }) {
  const { t, i18n } = useTranslation('invoicing');
  const { t: tError } = useTranslation('errors');
  const language = i18n.language;
  const navigate = useNavigate();
  const phone = useBreakpoint() === 'phone';
  const { issue: canIssue } = useInvoicingRights();
  const reference = useReferenceData().data;
  const company = useCompany().data;
  const termsLabel = usePaymentTermsLabel();
  const save = useSaveDraft(draft.id);
  const issue = useIssue(draft.id);
  const remove = useDeleteDraft(draft.id);
  const pdf = usePdf();
  const [saved, setSaved] = useState(draft);
  const [issueDate, setIssueDate] = useState(businessToday());
  const [asking, setAsking] = useState<'issue' | 'delete' | null>(null);

  const form = useForm<DraftValues>({ defaultValues: valuesOf(draft, language) });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const typedLines = useWatch({ control: form.control, name: 'lines' });
  const totals = previewTotals(typedLines ?? [], reference?.vatCodes ?? [], language);
  const { errors, isDirty } = form.formState;
  const { blocker, leave } = useUnsavedChanges(isDirty);
  const msg = (key?: string) => (key ? tError(key as never) : undefined);
  const credit = draft.kind === 'CREDIT_NOTE';
  const hasStampLine = (typedLines ?? []).some((line) => line.kind === 'stamp');

  const showServerErrors = (error: unknown) => {
    if (!(error instanceof ApiError)) return;
    for (const { field, code } of error.problem?.errors ?? []) {
      form.setError(formPath(field) as never, { message: `validation.${code}` });
    }
  };

  /** Saves the draft; returns it as the API now has it, or null when something was wrong. */
  const submit = async (): Promise<InvoiceDraft | null> => {
    const values = form.getValues();
    form.clearErrors();
    const issues = formIssues(values, language);
    for (const [field, message] of issues) form.setError(field as never, { message });
    if (issues.length > 0) return null;
    try {
      const next = await save.mutateAsync(draftBody(values, language, saved.version));
      setSaved(next);
      form.reset(valuesOf(next, language));
      return next;
    } catch (error) {
      showServerErrors(error);
      return null;
    }
  };

  const doIssue = async () => {
    const current = isDirty ? await submit() : saved;
    if (!current) {
      setAsking(null);
      return;
    }
    try {
      const invoice = await issue.mutateAsync({ version: current.version, issueDate });
      setAsking(null);
      leave(() => navigate(`/invoicing/invoices/${invoice.id}`, { replace: true }));
    } catch (error) {
      setAsking(null);
      showServerErrors(error);
    }
  };

  const failure = save.error ?? issue.error ?? remove.error ?? pdf.error;
  const fieldErrorsOnly = failure instanceof ApiError && Boolean(failure.problem?.errors?.length);
  const customer = useWatch({ control: form.control, name: 'customer' });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={credit ? t('editor.creditTitle') : t('editor.editTitle')}
        description={
          draft.creditedInvoice
            ? t('editor.credits', {
                reference: draft.creditedInvoice.reference,
                date: formatDate(draft.creditedInvoice.issueDate, language),
              })
            : t('editor.description')
        }
        actions={
          <Button
            variant="outline"
            disabled={pdf.isPending}
            onClick={() => pdf.mutate({ kind: 'draft', id: draft.id })}
          >
            <FileDownIcon data-icon="inline-start" />
            {t('editor.preview')}
          </Button>
        }
      />
      {failure && !fieldErrorsOnly && <ErrorMessage error={failure} />}
      {saved.deferredDeadline && (
        <p className="text-muted-foreground text-sm">
          {t('editor.deferred', { date: formatDate(saved.deferredDeadline, language) })}
        </p>
      )}
      {saved.stampDutyRequired && (
        <div className="border-border bg-muted/40 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
          <span className="flex-1">
            {hasStampLine ? t('editor.stampDuty.charged') : t('editor.stampDuty.required')}
          </span>
          {!hasStampLine && (company?.chargeStampDuty ?? true) && (
            <Button variant="outline" size="sm" onClick={() => lines.append(emptyLine('stamp'))}>
              {t('editor.stampDuty.charge')}
            </Button>
          )}
        </div>
      )}

      <form noValidate onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-6">
        <fieldset className="border-border grid gap-4 border-t pt-4 md:grid-cols-[12rem_1fr]">
          <legend className="sr-only">{t('editor.section.header')}</legend>
          <h2 aria-hidden="true" className="text-sm font-medium">
            {t('editor.section.header')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <CustomerField form={form} locked={credit || saved.shipments.length > 0} />
            </div>
            <FormField
              label={t('editor.fields.paymentTerms')}
              error={msg(errors.paymentTerms?.message)}
            >
              {(p) => (
                <NativeSelect className="w-full" {...p} {...form.register('paymentTerms')}>
                  <NativeSelectOption value="">
                    {t('editor.fields.fromCustomer')}
                  </NativeSelectOption>
                  {reference?.paymentTerms.map((terms) => (
                    <NativeSelectOption key={terms.code} value={terms.code}>
                      {termsLabel(terms.code)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField
              label={t('editor.fields.paymentMethod')}
              error={msg(errors.paymentMethod?.message)}
            >
              {(p) => (
                <NativeSelect className="w-full" {...p} {...form.register('paymentMethod')}>
                  <NativeSelectOption value="">
                    {t('editor.fields.fromCustomer')}
                  </NativeSelectOption>
                  {reference?.paymentMethods.map((method) => (
                    <NativeSelectOption key={method} value={method}>
                      {t(`methods.${method as 'MP05'}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t('editor.fields.language')} error={msg(errors.language?.message)}>
              {(p) => (
                <NativeSelect className="w-full" {...p} {...form.register('language')}>
                  <NativeSelectOption value="">
                    {t('editor.fields.fromCustomer')}
                  </NativeSelectOption>
                  {reference?.documentLanguages.map((code) => (
                    <NativeSelectOption key={code} value={code}>
                      {t(`languages.${code as 'it'}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
        </fieldset>

        <LinesEditor
          legend={t('editor.section.lines')}
          error={msg(errors.lines?.message)}
          keys={lines.fields.map((line) => line.id)}
          columns="md:grid-cols-[minmax(12rem,1fr)_6rem_7rem_5rem_9rem_10rem]"
          minLines={0}
          renderLine={(index) => <LineFields index={index} form={form} draft={saved} />}
          renderAside={(index) => <LineAside index={index} form={form} />}
          addLabel={t('editor.lines.add')}
          onAdd={() => lines.append(emptyLine('line'))}
          removeLabel={(n) => t('editor.lines.remove', { n })}
          onRemove={(index) => lines.remove(index)}
        />
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => lines.append(emptyLine('text'))}
          >
            {t('editor.lines.addText')}
          </Button>
        </div>

        <DocumentTotals {...totals} stampDuty={saved.stampDutyRequired ? '2.00' : undefined} />

        {saved.dueDatesPreview.length > 0 && (
          <section className="ml-auto flex w-full max-w-sm flex-col gap-1 text-sm">
            <h2 className="text-muted-foreground">{t('editor.dueDates')}</h2>
            {saved.dueDatesPreview.map((due) => (
              <div key={due.seq} className="flex justify-between gap-4">
                <span className="tabular-nums">{formatDate(due.dueDate, language)}</span>
                <MoneyAmount value={due.amount} />
              </div>
            ))}
          </section>
        )}

        <fieldset className="border-border grid gap-4 border-t pt-4 md:grid-cols-[12rem_1fr]">
          <legend className="sr-only">{t('editor.section.notes')}</legend>
          <h2 aria-hidden="true" className="text-sm font-medium">
            {t('editor.section.notes')}
          </h2>
          <FormField label={t('editor.fields.notes')} error={msg(errors.notes?.message)}>
            {(p) => <Textarea rows={2} {...p} {...form.register('notes')} />}
          </FormField>
        </fieldset>

        <div
          className={
            phone
              ? 'border-border bg-card sticky bottom-0 -mx-4 flex flex-wrap gap-3 border-t px-4 pt-3 pb-4'
              : 'border-border flex flex-wrap items-end justify-end gap-3 border-t pt-4'
          }
        >
          <Button type="button" variant="ghost" onClick={() => setAsking('delete')}>
            <TrashIcon data-icon="inline-start" />
            {t('editor.delete')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={phone ? 'flex-1' : undefined}
            disabled={save.isPending}
            onClick={() => void submit()}
          >
            {save.isPending ? t('editor.saving') : t('editor.save')}
          </Button>
          {canIssue && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('editor.issueDialog.date')}</span>
                <Input
                  type="date"
                  max={businessToday()}
                  value={issueDate}
                  onChange={(event) => setIssueDate(event.target.value)}
                />
              </label>
              <Button
                type="button"
                className={phone ? 'w-full' : undefined}
                disabled={issue.isPending || !customer}
                onClick={() => setAsking('issue')}
              >
                {t('editor.issue')}
              </Button>
            </>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={asking === 'issue'}
        title={t('editor.issueDialog.title', { kind: t(`kind.${draft.kind}`).toLowerCase() })}
        description={t('editor.issueDialog.description', {
          company: company?.legalName ?? '',
          customer: customer?.name ?? '',
          total: formatMoney(totals.total, language, 2),
        })}
        confirmLabel={t('editor.issueDialog.confirm')}
        pending={issue.isPending || save.isPending}
        onConfirm={() => void doIssue()}
        onCancel={() => setAsking(null)}
      />
      <ConfirmDialog
        open={asking === 'delete'}
        title={t('editor.deleteTitle')}
        description={t('editor.deleteDescription')}
        confirmLabel={t('editor.delete')}
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          void remove.mutateAsync(saved.version).then(() => {
            setAsking(null);
            leave(() => navigate('/invoicing/invoices', { replace: true }));
          })
        }
        onCancel={() => setAsking(null)}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}

type Form = UseFormReturn<DraftValues>;

/** The customer, searched among the active ones; fixed for shipments and credit notes. */
function CustomerField({ form, locked }: { form: Form; locked: boolean }) {
  const { t } = useTranslation('invoicing');
  const { t: tError } = useTranslation('errors');
  const customers = useCustomerSearch();
  const error = form.formState.errors.customer?.message;
  return (
    <Controller
      control={form.control}
      name="customer"
      render={({ field }) => (
        <FormField
          label={t('editor.fields.customer')}
          error={error ? tError(error as never) : undefined}
        >
          {(p) =>
            locked ? (
              <Input {...p} readOnly value={field.value?.name ?? ''} />
            ) : (
              <SearchCombobox<CustomerOption>
                {...p}
                value={field.value}
                onChange={field.onChange}
                queryKey={customers.queryKey}
                search={customers.search}
                itemKey={(party) => party.id}
                itemLabel={(party) => party.name}
                itemDetail={(party) => party.vatNumber}
                placeholder={t('editor.searchCustomer')}
              />
            )
          }
        </FormField>
      )}
    />
  );
}

/** The fields of one line, according to its kind (text, shipped, credited, free or an item). */
function LineFields({ index, form, draft }: { index: number; form: Form; draft: InvoiceDraft }) {
  const { t, i18n } = useTranslation('invoicing');
  const { t: tError } = useTranslation('errors');
  const vatLabel = useVatLabel();
  const items = useInvoiceItemSearch();
  const vatCodes = useReferenceData().data?.vatCodes ?? [];
  const line = useWatch({ control: form.control, name: `lines.${index}` });
  const lineErrors = form.formState.errors.lines?.[index];
  const msg = (key?: string) => (key ? tError(key as never) : undefined);
  const n = index + 1;
  const label = (field: string) => `${t('editor.lines.line', { n })} · ${field}`;
  if (!line) return null;

  // What kind of line it is goes under the description, as its hint: above it, it would push the
  // field below the others of the row.
  const description = (hint?: string) => (
    <FormField
      label={label(t('editor.lines.description'))}
      error={msg(lineErrors?.description?.message)}
      hint={hint}
    >
      {(p) => <Input autoComplete="off" {...p} {...form.register(`lines.${index}.description`)} />}
    </FormField>
  );

  if (line.kind === 'text') {
    return <div className="md:col-span-5">{description(t('editor.lines.text'))}</div>;
  }
  if (line.kind === 'stamp') {
    return <p className="py-2 text-sm md:col-span-5">{t('editor.lines.stampDuty')} · N1</p>;
  }

  const fixed = line.kind === 'shipped' || line.kind === 'credited';
  const shipment = draft.shipments.find((s) => s.fulfilmentId === line.fulfilmentId);
  const vat = vatCodes.find((code) => code.code === line.vatCode);
  return (
    <>
      <div className="flex flex-col gap-1">
        {fixed ? (
          description(
            line.kind === 'shipped'
              ? t('editor.lines.shipped', { document: shipment?.documentReference ?? '' })
              : t('editor.lines.credited'),
          )
        ) : (
          <>
            <Controller
              control={form.control}
              name={`lines.${index}.item`}
              render={({ field }) => (
                <FormField
                  label={label(t('editor.lines.item'))}
                  error={msg(lineErrors?.item?.message)}
                >
                  {(p) => (
                    <SearchCombobox<InvoiceItemOption>
                      {...p}
                      value={field.value}
                      onChange={(option) => {
                        field.onChange(option);
                        if (!option) return;
                        form.setValue(`lines.${index}.vatCode`, option.vatCode);
                        form.setValue(`lines.${index}.description`, option.description);
                        if (option.salePrice && !form.getValues(`lines.${index}.unitPrice`)) {
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
                      itemDetail={(option) => option.unit}
                      placeholder={t('editor.lines.searchItem')}
                    />
                  )}
                </FormField>
              )}
            />
            {description()}
          </>
        )}
      </div>
      <FormField label={t('editor.lines.quantity')} error={msg(lineErrors?.quantity?.message)}>
        {(p) => (
          <DecimalInput
            {...p}
            readOnly={line.kind === 'shipped'}
            {...form.register(`lines.${index}.quantity`)}
          />
        )}
      </FormField>
      <FormField label={t('editor.lines.unitPrice')} error={msg(lineErrors?.unitPrice?.message)}>
        {(p) => <DecimalInput {...p} {...form.register(`lines.${index}.unitPrice`)} />}
      </FormField>
      <FormField
        label={t('editor.lines.discount')}
        error={msg(lineErrors?.discountPercent?.message)}
      >
        {(p) => <DecimalInput {...p} {...form.register(`lines.${index}.discountPercent`)} />}
      </FormField>
      <FormField label={t('editor.lines.vat')} error={msg(lineErrors?.vatCode?.message)}>
        {(p) =>
          fixed ? (
            <Input {...p} readOnly value={vat ? vatLabel(vat.code, vat.nature) : line.vatCode} />
          ) : (
            <NativeSelect className="w-full" {...p} {...form.register(`lines.${index}.vatCode`)}>
              <NativeSelectOption value="">—</NativeSelectOption>
              {vatCodes.map((code) => (
                <NativeSelectOption key={code.code} value={code.code}>
                  {vatLabel(code.code, code.nature)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )
        }
      </FormField>
    </>
  );
}

/** Next to a line: its amount as typed. */
function LineAside({ index, form }: { index: number; form: Form }) {
  const { i18n } = useTranslation();
  const line = useWatch({ control: form.control, name: `lines.${index}` });
  if (!line) return null;
  const amount = previewAmount(line, i18n.language);
  return amount === null ? null : (
    <MoneyAmount
      value={amount}
      className="text-foreground text-sm font-medium whitespace-nowrap md:text-right"
    />
  );
}
