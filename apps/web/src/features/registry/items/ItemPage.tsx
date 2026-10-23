import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesGuard';
import { useUnsavedChanges } from '@/components/shared/useUnsavedChanges';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/auth/me';
import { serverFieldErrors } from '@/lib/form-errors';
import { type Item, useArchiveItem, useItem, useReferenceData, useSaveItem } from '../queries';
import { ArchiveButton, ArchivedBadge, FormSection, RecordActions, RecordNotices } from '../record';
import { vatLabel } from '../vat';
import {
  emptyItem,
  ITEM_FIELDS,
  itemBody,
  type ItemFormValues,
  itemSchema,
  itemValues,
} from './item-form';

/** `/items/new` and `/items/:id`: the record of an item. */
export function ItemPage() {
  const { id } = useParams();
  const item = useItem(id);
  const { t } = useTranslation('registry');

  if (!id) return <ItemForm />;
  if (item.isPending) return <Skeleton className="h-96 w-full" />;
  if (item.error) {
    if (!(item.error instanceof ApiError && item.error.status === 404)) {
      return <ErrorMessage error={item.error} />;
    }
    return (
      <EmptyState title={t('common.notFound')}>
        <Link className="underline underline-offset-4" to="/items">
          {t('common.backToList')}
        </Link>
      </EmptyState>
    );
  }
  return <ItemForm key={item.data.id} item={item.data} />;
}

function ItemForm({ item }: { item?: Item }) {
  const { t, i18n } = useTranslation('registry');
  const { t: tError } = useTranslation('errors');
  const language = i18n.language;
  const navigate = useNavigate();
  const me = useMe().data;
  const reference = useReferenceData().data;
  const save = useSaveItem(item?.id);
  const archive = useArchiveItem(item?.id ?? '');
  const refetch = useItem(item?.id).refetch;
  const [saved, setSaved] = useState(false);

  const canWrite = me?.permissions.includes('items:write') ?? false;
  const archived = Boolean(item?.archivedAt);
  const readOnly = !canWrite || archived;

  const schema = useMemo(() => itemSchema(language), [language]);
  const form = useForm<ItemFormValues>({
    resolver: zodResolver(schema),
    defaultValues: item ? itemValues(item, language) : emptyItem,
  });
  const { errors, isDirty } = form.formState;
  const { blocker, leave } = useUnsavedChanges(isDirty && !readOnly);
  const msg = (key?: string) => (key ? tError(key as never) : undefined);

  const reload = async () => {
    const latest = await refetch();
    if (latest.data) form.reset(itemValues(latest.data, language));
    save.reset();
    archive.reset();
  };

  const onSubmit = form.handleSubmit((values) => {
    setSaved(false);
    save.mutate(
      { ...itemBody(values, language), version: item?.version },
      {
        onSuccess: (result) => {
          if (item) {
            setSaved(true);
            form.reset(itemValues(result, language));
          } else {
            leave(() => navigate(`/items/${result.id}`, { replace: true }));
          }
        },
        onError: (error) => serverFieldErrors(error, form.setError as never, ITEM_FIELDS),
      },
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={item ? `${item.code} · ${item.description}` : t('items.newTitle')}
        description={item ? undefined : t('items.description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {item && (
              <Badge variant="secondary">
                {t(item.stockManaged ? 'items.type.good' : 'items.type.service')}
              </Badge>
            )}
            {archived && <ArchivedBadge />}
            {item && canWrite && (
              <ArchiveButton
                archived={archived}
                name={item.code}
                pending={archive.isPending}
                onConfirm={() =>
                  archive.mutateAsync({ archive: !archived, version: item.version }).catch(() => {})
                }
              />
            )}
          </div>
        }
      />

      <RecordNotices
        archived={archived}
        readOnly={!canWrite}
        error={save.error ?? archive.error}
        saved={saved && !isDirty}
        onReload={() => void reload()}
      />

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <fieldset disabled={readOnly} className="flex flex-col gap-6">
          <FormSection title={t('items.section.main')}>
            <FormField
              label={t('items.field.code')}
              error={msg(errors.code?.message)}
              hint={item ? t('items.hint.codeFixed') : t('items.hint.code')}
            >
              {(p) => (
                <Input
                  autoComplete="off"
                  className="font-mono"
                  readOnly={Boolean(item)}
                  {...p}
                  {...form.register('code')}
                />
              )}
            </FormField>
            <FormField label={t('items.field.unit')} error={msg(errors.unit?.message)}>
              {(p) => (
                <NativeSelect className="w-full" {...p} {...form.register('unit')}>
                  {reference?.units.map(({ code }) => (
                    <NativeSelectOption key={code} value={code}>
                      {code} · {t(`unit.${code as 'PZ'}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <div className="sm:col-span-2">
              <FormField
                label={t('items.field.description')}
                error={msg(errors.description?.message)}
              >
                {(p) => <Textarea rows={2} {...p} {...form.register('description')} />}
              </FormField>
            </div>
            <Controller
              control={form.control}
              name="stockManaged"
              render={({ field }) => (
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked)}
                      disabled={readOnly || Boolean(item)}
                    />
                    {t('items.field.stockManaged')}
                  </label>
                  <p className="text-muted-foreground text-xs">
                    {t(item ? 'items.hint.stockManagedFixed' : 'items.hint.stockManaged')}
                  </p>
                </div>
              )}
            />
          </FormSection>

          <FormSection title={t('items.section.sale')}>
            <FormField label={t('items.field.vatCode')} error={msg(errors.vatCode?.message)}>
              {(p) => (
                <NativeSelect className="w-full" {...p} {...form.register('vatCode')}>
                  {reference?.vatCodes.map((vat) => (
                    <NativeSelectOption key={vat.code} value={vat.code}>
                      {vatLabel(vat, t)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField
              label={t('items.field.salePrice')}
              error={msg(errors.salePrice?.message)}
              hint={t('items.hint.salePrice')}
            >
              {(p) => <DecimalInput className="w-40" {...p} {...form.register('salePrice')} />}
            </FormField>
          </FormSection>

          <FormSection title={t('items.section.notes')}>
            <div className="sm:col-span-2">
              <FormField label={t('items.field.notes')} error={msg(errors.notes?.message)}>
                {(p) => <Textarea rows={3} {...p} {...form.register('notes')} />}
              </FormField>
            </div>
          </FormSection>
        </fieldset>

        {!readOnly && (
          <RecordActions
            isNew={!item}
            isDirty={isDirty}
            saving={save.isPending}
            onCancel={() => (item ? form.reset() : void navigate('/items'))}
          />
        )}
      </form>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
