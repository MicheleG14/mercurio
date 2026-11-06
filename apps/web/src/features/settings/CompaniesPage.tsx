import { FileTextIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { DataTable } from '@/components/shared/DataTable';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { companyStore, useCompanyId } from '@/lib/auth/company';
import { useMe } from '@/lib/auth/me';
import { countryOptions } from '@/lib/countries';
import { uuidv7 } from '@/lib/uuid';
import { type Company, useAddCompany, useCompanies } from './queries';

/**
 * `/settings/companies`: the companies of the group (phase 7). An administrator adds one with its
 * identity, then completes its invoice data on `/settings/company`, which works on the current
 * company: opening a row makes it current, as the selector in the top bar does.
 */
export function CompaniesPage() {
  const { t } = useTranslation('settings');
  const me = useMe().data;
  const current = useCompanyId();
  const navigate = useNavigate();
  const companies = useCompanies();
  const [adding, setAdding] = useState(false);

  if (me && !me.permissions.includes('companies:manage')) return <Navigate to="/" replace />;

  const open = (company: Company) => {
    if (me?.tenant) companyStore.choose(me.tenant.id, company.id);
    void navigate('/settings/company');
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('companies.title')}
        description={t('companies.description')}
        actions={
          !adding && (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon data-icon="inline-start" />
              {t('companies.add')}
            </Button>
          )
        }
      />
      {adding && <NewCompanyForm onCancel={() => setAdding(false)} onAdded={open} />}
      <DataTable
        rows={companies.data?.items}
        rowKey={(row) => row.id}
        isLoading={companies.isPending}
        error={companies.error}
        emptyTitle={t('companies.empty')}
        page={1}
        pageSize={100}
        total={companies.data?.items.length ?? 0}
        onPageChange={() => {}}
        columns={[
          {
            key: 'name',
            header: t('companies.legalName'),
            card: 'title',
            cell: (row) => (
              <span className="flex items-center gap-2 font-medium">
                {row.legalName}
                {row.id === current && <Badge variant="secondary">{t('companies.current')}</Badge>}
              </span>
            ),
          },
          {
            key: 'vat',
            header: t('companies.vatNumber'),
            card: 'subtitle',
            cell: (row) => <span className="font-mono">{row.vatNumber}</span>,
          },
          {
            key: 'state',
            header: t('companies.header'),
            card: 'detail',
            cell: (row) =>
              row.missingForInvoices.length === 0 ? (
                <Badge variant="success">{t('company.complete')}</Badge>
              ) : (
                <Badge variant="warning">
                  {t('company.missing', {
                    fields: row.missingForInvoices
                      .map((f) => t(`company.fields.${f}` as never))
                      .join(', '),
                  })}
                </Badge>
              ),
          },
          {
            key: 'actions',
            header: '',
            card: 'detail',
            className: 'text-right',
            cell: (row) => (
              <Button className="relative z-10" variant="ghost" size="sm" onClick={() => open(row)}>
                <FileTextIcon data-icon="inline-start" />
                {t('companies.header')}
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * The identity of a new company. Its id is chosen when the form opens (B33): a second click on
 * "save" returns the same company instead of adding two.
 */
function NewCompanyForm({
  onCancel,
  onAdded,
}: {
  onCancel: () => void;
  onAdded: (company: Company) => void;
}) {
  const { t, i18n } = useTranslation('settings');
  const { t: tc } = useTranslation();
  const add = useAddCompany();
  const [id] = useState(() => uuidv7());
  const [legalName, setLegalName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [taxCode, setTaxCode] = useState('');
  const [country, setCountry] = useState('IT');

  return (
    <form
      noValidate
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate(
          { id, legalName, vatNumber, taxCode: taxCode || undefined, country },
          { onSuccess: onAdded },
        );
      }}
    >
      <h2 className="text-sm font-medium">{t('companies.addTitle')}</h2>
      <p className="text-muted-foreground text-sm">{t('companies.addHint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('companies.legalName')}>
          {(p) => (
            <Input
              {...p}
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('companies.country')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={country}
              onChange={(event) => setCountry(event.target.value)}
            >
              {countryOptions(i18n.language).map((option) => (
                <NativeSelectOption key={option.code} value={option.code}>
                  {option.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('companies.vatNumber')}>
          {(p) => (
            <Input
              {...p}
              className="font-mono"
              autoComplete="off"
              value={vatNumber}
              onChange={(event) => setVatNumber(event.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('companies.taxCode')}>
          {(p) => (
            <Input
              {...p}
              className="font-mono uppercase"
              autoComplete="off"
              value={taxCode}
              onChange={(event) => setTaxCode(event.target.value)}
            />
          )}
        </FormField>
      </div>
      <ErrorMessage error={add.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" disabled={add.isPending}>
          {t('companies.add')}
        </Button>
      </div>
    </form>
  );
}
