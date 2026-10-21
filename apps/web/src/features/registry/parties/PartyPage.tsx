import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesGuard';
import { useUnsavedChanges } from '@/components/shared/useUnsavedChanges';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/auth/me';
import { serverFieldErrors } from '@/lib/form-errors';
import { countryOptions } from '../countries';
import {
  type Party,
  useArchiveParty,
  useParty,
  usePartyLookup,
  useReferenceData,
  useSaveParty,
} from '../queries';
import { ArchiveButton, ArchivedBadge, FormSection, RecordActions, RecordNotices } from '../record';
import {
  emptyParty,
  lookupIdentifiers,
  PARTY_FIELDS,
  PARTY_KINDS,
  partyBody,
  type PartyFormValues,
  partySchema,
  partyValues,
  visibleFields,
} from './party-form';

/** `/parties/new` and `/parties/:id`: the record of a customer or supplier. */
export function PartyPage() {
  const { id } = useParams();
  const party = useParty(id);
  const { t } = useTranslation('registry');

  if (!id) return <PartyForm />;
  if (party.isPending) return <Skeleton className="h-96 w-full" />;
  if (party.error) {
    if (!(party.error instanceof ApiError && party.error.status === 404)) {
      return <ErrorMessage error={party.error} />;
    }
    return (
      <EmptyState title={t('common.notFound')}>
        <Link className="underline underline-offset-4" to="/parties">
          {t('common.backToList')}
        </Link>
      </EmptyState>
    );
  }
  return <PartyForm key={party.data.id} party={party.data} />;
}

function PartyForm({ party }: { party?: Party }) {
  const { t, i18n } = useTranslation('registry');
  const { t: tError } = useTranslation('errors');
  const navigate = useNavigate();
  const me = useMe().data;
  const reference = useReferenceData().data;
  const save = useSaveParty(party?.id);
  const archive = useArchiveParty(party?.id ?? '');
  const refetch = useParty(party?.id).refetch;
  const [saved, setSaved] = useState(false);

  const canWrite = me?.permissions.includes('parties:write') ?? false;
  const archived = Boolean(party?.archivedAt);
  const readOnly = !canWrite || archived;

  const form = useForm<PartyFormValues>({
    resolver: zodResolver(partySchema),
    defaultValues: party ? partyValues(party) : emptyParty,
  });
  const { errors, isDirty } = form.formState;
  const { blocker, leave } = useUnsavedChanges(isDirty && !readOnly);
  const [kind, country] = useWatch({ control: form.control, name: ['kind', 'country'] });
  const show = visibleFields(kind, country);
  const countries = useMemo(() => countryOptions(i18n.language), [i18n.language]);
  const msg = (key?: string) => (key ? tError(key as never) : undefined);

  // "Already there?" Asked once the identifier looks complete, when the field is left.
  const [lookup, setLookup] = useState<{ vatNumber?: string; taxCode?: string }>({});
  const matches = usePartyLookup(lookup).data?.items.filter((m) => m.id !== party?.id) ?? [];
  const checkExisting = () => setLookup(lookupIdentifiers(form.getValues()));

  /** After a conflict: the latest version replaces what was typed, as the person chose. */
  const reload = async () => {
    const latest = await refetch();
    if (latest.data) form.reset(partyValues(latest.data));
    save.reset();
    archive.reset();
  };

  const existingId =
    save.error instanceof ApiError && save.error.problem?.code === 'PARTY_VAT_TAKEN'
      ? save.error.problem.existingId
      : undefined;

  const onSubmit = form.handleSubmit((values) => {
    setSaved(false);
    save.mutate(
      { ...partyBody(values), version: party?.version },
      {
        onSuccess: (result) => {
          if (party) {
            setSaved(true);
            form.reset(partyValues(result));
          } else {
            leave(() => navigate(`/parties/${result.id}`, { replace: true }));
          }
        },
        onError: (error) => serverFieldErrors(error, form.setError as never, PARTY_FIELDS),
      },
    );
  });

  const nameLabel =
    kind === 'ORGANIZATION'
      ? t('parties.field.organizationName')
      : kind === 'SOLE_TRADER'
        ? t('parties.field.tradeName')
        : t('parties.field.legalName');
  const category = reference?.legalForms.find((form) => form.code === party?.legalForm)?.category;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={party?.name ?? t('parties.newTitle')}
        description={party ? t(`parties.kind.${party.kind}`) : t('parties.description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {party?.isCustomer && <Badge variant="secondary">{t('parties.role.customer')}</Badge>}
            {party?.isSupplier && <Badge variant="secondary">{t('parties.role.supplier')}</Badge>}
            {archived && <ArchivedBadge />}
            {party && canWrite && (
              <ArchiveButton
                archived={archived}
                name={party.name}
                pending={archive.isPending}
                onConfirm={() =>
                  archive
                    .mutateAsync({ archive: !archived, version: party.version })
                    .catch(() => {})
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
      {existingId && (
        <Alert variant="warning">
          <Link className="underline underline-offset-4" to={`/parties/${existingId}`}>
            {t('parties.existing')}
          </Link>
        </Alert>
      )}

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <fieldset disabled={readOnly} className="flex flex-col gap-6">
          <FormSection title={t('parties.section.main')}>
            <FormField label={t('parties.field.kind')}>
              {(p) => (
                <NativeSelect className="w-full" {...p} {...form.register('kind')}>
                  {PARTY_KINDS.map((value) => (
                    <NativeSelectOption key={value} value={value}>
                      {t(`parties.kind.${value}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('parties.field.roles')}</span>
              <div className="flex h-9 items-center gap-5">
                {(['isCustomer', 'isSupplier'] as const).map((name) => (
                  <Controller
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(checked) => field.onChange(checked)}
                          aria-invalid={Boolean(errors.isCustomer)}
                          disabled={readOnly}
                        />
                        {t(
                          name === 'isCustomer' ? 'parties.role.customer' : 'parties.role.supplier',
                        )}
                      </label>
                    )}
                  />
                ))}
              </div>
              {errors.isCustomer && (
                <p className="text-destructive text-xs">{msg(errors.isCustomer.message)}</p>
              )}
            </div>
            {show.personNames && (
              <>
                <FormField
                  label={t('parties.field.lastName')}
                  error={msg(errors.lastName?.message)}
                >
                  {(p) => <Input autoComplete="off" {...p} {...form.register('lastName')} />}
                </FormField>
                <FormField
                  label={t('parties.field.firstName')}
                  error={msg(errors.firstName?.message)}
                >
                  {(p) => <Input autoComplete="off" {...p} {...form.register('firstName')} />}
                </FormField>
              </>
            )}
            {show.legalName && (
              <FormField label={nameLabel} error={msg(errors.legalName?.message)}>
                {(p) => <Input autoComplete="off" {...p} {...form.register('legalName')} />}
              </FormField>
            )}
            {show.legalForm && (
              <FormField
                label={t('parties.field.legalForm')}
                error={msg(errors.legalForm?.message)}
                hint={
                  category
                    ? `${t('parties.field.legalCategory')}: ${t(`parties.legalCategory.${category as 'CAPITAL'}`)}`
                    : undefined
                }
              >
                {(p) => (
                  <NativeSelect className="w-full" {...p} {...form.register('legalForm')}>
                    <NativeSelectOption value="">{t('parties.legalForm.none')}</NativeSelectOption>
                    {reference?.legalForms.map((f) => (
                      <NativeSelectOption key={f.code} value={f.code}>
                        {t(`parties.legalForm.${f.code as 'SRL'}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            )}
          </FormSection>

          <FormSection title={t('parties.section.tax')}>
            <FormField label={t('parties.field.country')} error={msg(errors.country?.message)}>
              {(p) => (
                <NativeSelect className="w-full" {...p} {...form.register('country')}>
                  {countries.map((c) => (
                    <NativeSelectOption key={c.code} value={c.code}>
                      {c.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            {country !== 'IT' && (
              <p className="text-muted-foreground self-end text-xs">
                {t('parties.hint.foreignIdentifier')}
              </p>
            )}
            {show.vatNumber && (
              <FormField
                label={t('parties.field.vatNumber')}
                error={msg(errors.vatNumber?.message)}
              >
                {(p) => (
                  <Input
                    autoComplete="off"
                    className="font-mono"
                    {...p}
                    {...form.register('vatNumber', { onBlur: checkExisting })}
                  />
                )}
              </FormField>
            )}
            <FormField
              label={t('parties.field.taxCode')}
              error={msg(errors.taxCode?.message)}
              hint={
                country === 'IT' && (kind === 'COMPANY' || kind === 'ORGANIZATION')
                  ? t('parties.hint.taxCodeCompany')
                  : undefined
              }
            >
              {(p) => (
                <Input
                  autoComplete="off"
                  className="font-mono uppercase"
                  {...p}
                  {...form.register('taxCode', { onBlur: checkExisting })}
                />
              )}
            </FormField>
            {matches.length > 0 && (
              <div className="sm:col-span-2">
                {matches.map((match) => (
                  <Alert key={match.id} variant="warning" className="flex flex-wrap gap-x-2">
                    <span>
                      {t(match.archivedAt ? 'parties.lookup.archived' : 'parties.lookup.active', {
                        name: match.name,
                      })}
                    </span>
                    <Link className="underline underline-offset-4" to={`/parties/${match.id}`}>
                      {t(match.archivedAt ? 'parties.lookup.openToRestore' : 'parties.lookup.open')}
                    </Link>
                  </Alert>
                ))}
              </div>
            )}
          </FormSection>

          <FormSection title={t('parties.section.address')}>
            <div className="sm:col-span-2">
              <FormField label={t('parties.field.address')} error={msg(errors.address?.message)}>
                {(p) => <Input autoComplete="off" {...p} {...form.register('address')} />}
              </FormField>
            </div>
            <FormField
              label={t('parties.field.postalCode')}
              error={msg(errors.postalCode?.message)}
            >
              {(p) => <Input autoComplete="off" {...p} {...form.register('postalCode')} />}
            </FormField>
            <FormField label={t('parties.field.city')} error={msg(errors.city?.message)}>
              {(p) => <Input autoComplete="off" {...p} {...form.register('city')} />}
            </FormField>
            {show.province && (
              <FormField
                label={t('parties.field.province')}
                error={msg(errors.province?.message)}
                hint={t('parties.hint.province')}
              >
                {(p) => (
                  <Input
                    autoComplete="off"
                    maxLength={2}
                    className="w-20 uppercase"
                    {...p}
                    {...form.register('province')}
                  />
                )}
              </FormField>
            )}
          </FormSection>

          <FormSection title={t('parties.section.contacts')}>
            <FormField label={t('parties.field.email')} error={msg(errors.email?.message)}>
              {(p) => <Input type="email" autoComplete="off" {...p} {...form.register('email')} />}
            </FormField>
            <FormField label={t('parties.field.phone')} error={msg(errors.phone?.message)}>
              {(p) => <Input type="tel" autoComplete="off" {...p} {...form.register('phone')} />}
            </FormField>
            <FormField label={t('parties.field.pecEmail')} error={msg(errors.pecEmail?.message)}>
              {(p) => (
                <Input type="email" autoComplete="off" {...p} {...form.register('pecEmail')} />
              )}
            </FormField>
            <FormField
              label={t('parties.field.sdiCode')}
              error={msg(errors.sdiCode?.message)}
              hint={t('parties.hint.sdiCode')}
            >
              {(p) => (
                <Input
                  autoComplete="off"
                  maxLength={7}
                  className="w-32 font-mono uppercase"
                  {...p}
                  {...form.register('sdiCode')}
                />
              )}
            </FormField>
          </FormSection>

          <FormSection title={t('parties.section.notes')}>
            <div className="sm:col-span-2">
              <FormField label={t('parties.field.notes')} error={msg(errors.notes?.message)}>
                {(p) => <Textarea rows={3} {...p} {...form.register('notes')} />}
              </FormField>
            </div>
          </FormSection>
        </fieldset>

        {!readOnly && (
          <RecordActions
            isNew={!party}
            isDirty={isDirty}
            saving={save.isPending}
            onCancel={() => (party ? form.reset() : void navigate('/parties'))}
          />
        )}
      </form>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
