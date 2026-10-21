import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar } from '@/components/shared/FilterBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useMe } from '@/lib/auth/me';
import { formatMoney } from '@/lib/decimal';
import { useListParams } from '@/lib/list-params';
import { useItems, useReferenceData } from '../queries';
import { ArchivedBadge } from '../record';
import { vatLabel } from '../vat';

const TYPES = { goods: true, services: false } as const;

/** `/items`: the item catalog, searched and filtered on the server, state in the URL. */
export function ItemsPage() {
  const { t, i18n } = useTranslation('registry');
  const me = useMe().data;
  const reference = useReferenceData().data;
  const list = useListParams(['type', 'archived'], { field: 'code', direction: 'asc' });
  const type =
    list.filters.type === 'goods' || list.filters.type === 'services'
      ? list.filters.type
      : undefined;
  const archived = list.filters.archived === 'true';
  const items = useItems({
    page: list.page,
    q: list.q || undefined,
    sort: `${list.sort.field}:${list.sort.direction}`,
    stockManaged: type ? TYPES[type] : undefined,
    archived,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('items.title')}
        description={t('items.description')}
        actions={
          me?.permissions.includes('items:write') && (
            <Link to="/items/new" className={buttonVariants()}>
              <PlusIcon data-icon="inline-start" />
              {t('items.new')}
            </Link>
          )
        }
      />
      <FilterBar
        activeCount={(type ? 1 : 0) + (archived ? 1 : 0)}
        search={
          <SearchInput
            value={list.q}
            onSearch={list.setQuery}
            label={t('items.search')}
            placeholder={t('items.search')}
          />
        }
      >
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('items.filter.label')}</span>
          <NativeSelect
            value={type ?? ''}
            onChange={(event) => list.setFilter('type', event.target.value || undefined)}
          >
            <NativeSelectOption value="">{t('items.filter.all')}</NativeSelectOption>
            <NativeSelectOption value="goods">{t('items.filter.goods')}</NativeSelectOption>
            <NativeSelectOption value="services">{t('items.filter.services')}</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={archived}
            onCheckedChange={(checked) => list.setFilter('archived', checked ? 'true' : undefined)}
          />
          {t('common.showArchived')}
        </label>
      </FilterBar>
      <DataTable
        rows={items.data?.items}
        rowKey={(row) => row.id}
        isLoading={items.isPending}
        error={items.error}
        emptyTitle={t('items.empty')}
        page={items.data?.page ?? list.page}
        pageSize={items.data?.pageSize ?? 25}
        total={items.data?.total ?? 0}
        onPageChange={list.setPage}
        sort={list.sort}
        onSortChange={list.setSort}
        columns={[
          {
            key: 'code',
            header: t('items.columns.code'),
            sortField: 'code',
            card: 'title',
            cell: (row) => (
              <span className="flex items-center gap-2">
                <Link
                  to={`/items/${row.id}`}
                  className="font-mono font-medium underline-offset-4 after:absolute after:inset-0 hover:underline md:after:hidden"
                >
                  {row.code}
                </Link>
                {row.archivedAt && <ArchivedBadge />}
              </span>
            ),
          },
          {
            key: 'description',
            header: t('items.columns.description'),
            sortField: 'description',
            card: 'subtitle',
            className: 'max-w-md truncate',
            cell: (row) => row.description,
          },
          {
            key: 'unit',
            header: t('items.columns.unit'),
            tablet: false,
            cell: (row) => row.unit,
          },
          {
            key: 'vatCode',
            header: t('items.columns.vatCode'),
            tablet: false,
            cell: (row) => {
              const vat = reference?.vatCodes.find((v) => v.code === row.vatCode);
              return vat ? vatLabel(vat, t) : row.vatCode;
            },
          },
          {
            key: 'salePrice',
            header: t('items.columns.salePrice'),
            card: 'detail',
            className: 'text-right tabular-nums',
            cell: (row) =>
              row.salePrice === null ? (
                <span className="text-muted-foreground">{t('items.noPrice')}</span>
              ) : (
                formatMoney(row.salePrice, i18n.language)
              ),
          },
        ]}
      />
    </div>
  );
}
