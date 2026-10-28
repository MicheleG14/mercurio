import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar } from '@/components/shared/FilterBar';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { formatDate } from '@/lib/format';
import { useListParams } from '@/lib/list-params';
import { useOrderRights } from './hooks';
import { OrderStatusBadges } from './parts';
import { type OrderKind, type OrderStatus, type OrdersQuery, useOrders } from './queries';

const STATUSES = ['OPEN', 'DRAFT', 'CONFIRMED', 'PARTIAL', 'COMPLETED', 'CANCELLED'] as const;
const isStatus = (value: string | undefined): value is (typeof STATUSES)[number] =>
  STATUSES.includes(value as never);

/** `/orders/sales` and `/orders/purchase`: the orders of one kind, filters in the URL. */
export function OrdersPage({ kind }: { kind: OrderKind }) {
  const { t, i18n } = useTranslation('orders');
  const { write } = useOrderRights();
  const list = useListParams(['status', 'late', 'uncovered'], { field: 'date', direction: 'desc' });
  const status = isStatus(list.filters.status) ? list.filters.status : undefined;
  const late = list.filters.late === 'true';
  const uncovered = kind === 'SALES' && list.filters.uncovered === 'true';
  const query: OrdersQuery = {
    kind,
    page: list.page,
    q: list.q || undefined,
    sort: `${list.sort.field}:${list.sort.direction}`,
    status: status as OrderStatus | 'OPEN' | undefined,
    late: late || undefined,
    uncovered: uncovered || undefined,
  };
  const orders = useOrders(query);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(`list.title.${kind}`)}
        description={t(`list.description.${kind}`)}
        actions={
          write && (
            <Link to={`/orders/new?kind=${kind}`} className={buttonVariants()}>
              <PlusIcon data-icon="inline-start" />
              {t('list.new')}
            </Link>
          )
        }
      />
      <FilterBar
        activeCount={[status, late, uncovered].filter(Boolean).length}
        search={
          <SearchInput
            value={list.q}
            onSearch={list.setQuery}
            label={t('list.search')}
            placeholder={t('list.search')}
          />
        }
      >
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('list.filter.status')}</span>
          <NativeSelect
            value={status ?? ''}
            onChange={(event) => list.setFilter('status', event.target.value || undefined)}
          >
            <NativeSelectOption value="">{t('list.filter.all')}</NativeSelectOption>
            {STATUSES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value === 'OPEN' ? t('list.filter.open') : t(`status.${kind}.${value}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={late}
            onCheckedChange={(checked) => list.setFilter('late', checked ? 'true' : undefined)}
          />
          {t('list.filter.late')}
        </label>
        {kind === 'SALES' && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={uncovered}
              onCheckedChange={(checked) =>
                list.setFilter('uncovered', checked ? 'true' : undefined)
              }
            />
            {t('list.filter.uncovered')}
          </label>
        )}
      </FilterBar>
      <DataTable
        rows={orders.data?.items}
        rowKey={(row) => row.id}
        isLoading={orders.isPending}
        error={orders.error}
        emptyTitle={t('list.empty')}
        page={orders.data?.page ?? list.page}
        pageSize={orders.data?.pageSize ?? 25}
        total={orders.data?.total ?? 0}
        onPageChange={list.setPage}
        sort={list.sort}
        onSortChange={list.setSort}
        columns={[
          {
            key: 'number',
            header: t('list.columns.number'),
            sortField: 'number',
            card: 'title',
            cell: (row) => (
              <Link
                to={`/orders/${row.id}`}
                className="font-mono font-medium underline-offset-4 after:absolute after:inset-0 hover:underline md:after:hidden"
              >
                {row.reference ?? t('list.draft')}
              </Link>
            ),
          },
          {
            key: 'date',
            header: t('list.columns.date'),
            sortField: 'date',
            card: 'subtitle',
            className: 'tabular-nums',
            cell: (row) => formatDate(row.orderDate, i18n.language),
          },
          {
            key: 'party',
            header: t(`list.columns.party.${kind}`),
            sortField: 'party',
            card: 'subtitle',
            className: 'max-w-xs truncate',
            cell: (row) => row.partyName,
          },
          {
            key: 'requestedDate',
            header: t('list.columns.requestedDate'),
            sortField: 'requestedDate',
            tablet: false,
            className: 'tabular-nums',
            cell: (row) => (row.requestedDate ? formatDate(row.requestedDate, i18n.language) : ''),
          },
          {
            key: 'total',
            header: t('list.columns.total'),
            sortField: 'total',
            card: 'detail',
            className: 'text-right',
            cell: (row) => <MoneyAmount value={row.total} />,
          },
          {
            key: 'status',
            header: t('list.columns.status'),
            card: 'detail',
            cell: (row) => (
              <OrderStatusBadges
                kind={row.kind}
                status={row.status}
                late={row.late}
                uncovered={row.uncovered}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
