import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/auth/me';
import { type Company, useCompanyData, useSaveCompanyData, useTaxRegimes } from './queries';

const TEXT_FIELDS = [
  'address',
  'postalCode',
  'city',
  'province',
  'reaOffice',
  'reaNumber',
  'shareCapital',
  'iban',
  'email',
  'pecEmail',
  'phone',
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

/**
 * `/settings/company`: what invoices print of the current company (registered office, REA,
 * capital, tax regime, IBAN). Name and identifiers are set when the company is created, by the
 * platform operator, and only shown here.
 */
export function CompanyPage() {
  const me = useMe().data;
  const company = useCompanyData();
  if (!me?.permissions.includes('companies:manage')) return <Navigate to="/" replace />;
  if (company.error) return <ErrorMessage error={company.error} />;
  if (company.isPending) return <Skeleton className="h-64 w-full" />;
  return <CompanyForm key={company.data.version} company={company.data} />;
}

function CompanyForm({ company }: { company: Company }) {
  const { t } = useTranslation('settings');
  const { t: tError } = useTranslation('errors');
  const regimes = useTaxRegimes().data ?? [];
  const save = useSaveCompanyData();
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(TEXT_FIELDS.map((field) => [field, company[field] ?? ''])) as Record<
        TextField,
        string
      >,
  );
  const [taxRegime, setTaxRegime] = useState(company.taxRegime);
  const [soleShareholder, setSoleShareholder] = useState(
    company.soleShareholder === null ? '' : String(company.soleShareholder),
  );
  const [inLiquidation, setInLiquidation] = useState(company.inLiquidation);
  const [chargeStampDuty, setChargeStampDuty] = useState(company.chargeStampDuty);
  const errors = new Map(
    (save.error instanceof ApiError ? (save.error.problem?.errors ?? []) : []).map((e) => [
      e.field,
      tError(`validation.${e.code}` as never),
    ]),
  );

  const submit = () =>
    save.mutate({
      version: company.version,
      ...Object.fromEntries(TEXT_FIELDS.map((field) => [field, values[field].trim() || null])),
      taxRegime,
      soleShareholder: soleShareholder === '' ? null : soleShareholder === 'true',
      inLiquidation,
      chargeStampDuty,
    });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('company.title')} description={t('company.description')} />
      <section className="flex flex-col gap-1 text-sm">
        <p className="font-medium">{company.legalName}</p>
        <p className="text-muted-foreground font-mono">
          {company.vatNumber}
          {company.taxCode ? ` · ${company.taxCode}` : ''}
        </p>
        {company.missingForInvoices.length > 0 ? (
          <p className="text-warning">
            {t('company.missing', {
              fields: company.missingForInvoices
                .map((f) => t(`company.fields.${f as 'address'}`))
                .join(', '),
            })}
          </p>
        ) : (
          <Badge variant="success" className="w-fit">
            {t('company.complete')}
          </Badge>
        )}
      </section>
      {save.error && !errors.size && <ErrorMessage error={save.error} />}
      <form
        noValidate
        className="grid max-w-3xl gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {TEXT_FIELDS.map((field) => (
          <div key={field} className={field === 'address' ? 'sm:col-span-2' : undefined}>
            <FormField label={t(`company.fields.${field}`)} error={errors.get(field)}>
              {(p) => (
                <Input
                  autoComplete="off"
                  {...p}
                  value={values[field]}
                  onChange={(event) => setValues({ ...values, [field]: event.target.value })}
                />
              )}
            </FormField>
          </div>
        ))}
        <FormField label={t('company.fields.taxRegime')} error={errors.get('taxRegime')}>
          {(p) => (
            <NativeSelect
              className="w-full"
              {...p}
              value={taxRegime}
              onChange={(event) => setTaxRegime(event.target.value)}
            >
              {regimes.map((code) => (
                <NativeSelectOption key={code} value={code}>
                  {code} · {t(`company.regimes.${code as 'RF01'}`, { defaultValue: code })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('company.fields.soleShareholder')}>
          {(p) => (
            <NativeSelect
              className="w-full"
              {...p}
              value={soleShareholder}
              onChange={(event) => setSoleShareholder(event.target.value)}
            >
              <NativeSelectOption value="">{t('company.shareholders.none')}</NativeSelectOption>
              <NativeSelectOption value="true">{t('company.shareholders.sole')}</NativeSelectOption>
              <NativeSelectOption value="false">
                {t('company.shareholders.several')}
              </NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={inLiquidation} onCheckedChange={(c) => setInLiquidation(Boolean(c))} />
          {t('company.fields.inLiquidation')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={chargeStampDuty}
            onCheckedChange={(c) => setChargeStampDuty(Boolean(c))}
          />
          {t('company.fields.chargeStampDuty')}
        </label>
        <div className="border-border flex justify-end border-t pt-4 sm:col-span-2">
          <Button type="submit" disabled={save.isPending}>
            {t('company.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
