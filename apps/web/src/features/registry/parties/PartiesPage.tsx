import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DataTable } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useMe } from '@/lib/auth/me';
import { useListParams } from '@/lib/list-params';
import { countryName } from '../countries';
import { useParties } from '../queries';
import { ArchivedBadge } from '../record';

const ROLES = ['customer', 'supplier'] as const;

/** `/parties`: customers and suppliers, searched and filtered on the server, state in the URL. */
export function PartiesPage() {
  const { t, i18n } = useTranslation('registry');
  const me = useMe().data;
  const list = useListParams(['role', 'archived'], { field: 'name', direction: 'asc' });
  const role = ROLES.find((value) => value === list.filters.role);
  const archived = list.filters.archived === 'true';
  const parties = useParties({
    page: list.page,
    q: list.q || undefined,
    sort: `${list.sort.field}:${list.sort.direction}`,
    role,
    archived,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('parties.title')}
        description={t('parties.description')}
        actions={
          me?.permissions.includes('parties:write') && (
            <Link to="/parties/new" className={buttonVariants()}>
              <PlusIcon data-icon="inline-start" />
              {t('parties.new')}
            </Link>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <SearchInput
          value={list.q}
          onSearch={list.setQuery}
          label={t('parties.search')}
          placeholder={t('parties.search')}
        />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('parties.filter.label')}</span>
          <NativeSelect
            value={role ?? ''}
            onChange={(event) => list.setFilter('role', event.target.value || undefined)}
          >
            <NativeSelectOption value="">{t('parties.filter.all')}</NativeSelectOption>
            {ROLES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(`parties.filter.${value}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={archived}
            onCheckedChange={(checked) => list.setFilter('archived', checked ? 'true' : undefined)}
          />
          {t('common.showArchived')}
        </label>
      </div>
      <DataTable
        rows={parties.data?.items}
        rowKey={(row) => row.id}
        isLoading={parties.isPending}
        error={parties.error}
        emptyTitle={t('parties.empty')}
        page={parties.data?.page ?? list.page}
        pageSize={parties.data?.pageSize ?? 25}
        total={parties.data?.total ?? 0}
        onPageChange={list.setPage}
        sort={list.sort}
        onSortChange={list.setSort}
        columns={[
          {
            key: 'name',
            header: t('parties.columns.name'),
            sortField: 'name',
            cell: (row) => (
              <span className="flex items-center gap-2">
                <Link
                  to={`/parties/${row.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.name}
                </Link>
                {row.archivedAt && <ArchivedBadge />}
              </span>
            ),
          },
          {
            key: 'roles',
            header: t('parties.columns.roles'),
            cell: (row) => (
              <span className="flex gap-1">
                {row.isCustomer && <Badge variant="secondary">{t('parties.role.customer')}</Badge>}
                {row.isSupplier && <Badge variant="outline">{t('parties.role.supplier')}</Badge>}
              </span>
            ),
          },
          {
            key: 'kind',
            header: t('parties.columns.kind'),
            cell: (row) => t(`parties.kind.${row.kind}`),
          },
          {
            key: 'identifier',
            header: t('parties.columns.identifier'),
            className: 'font-mono',
            cell: (row) => row.vatNumber ?? row.taxCode ?? '',
          },
          {
            key: 'city',
            header: t('parties.columns.city'),
            cell: (row) =>
              [
                row.city && (row.province ? `${row.city} (${row.province})` : row.city),
                row.country !== 'IT' && countryName(row.country, i18n.language),
              ]
                .filter(Boolean)
                .join(', '),
          },
        ]}
      />
    </div>
  );
}
