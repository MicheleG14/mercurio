import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar } from '@/components/shared/FilterBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useListParams } from '@/lib/list-params';
import { useQuantity } from './hooks';
import { BelowBadge, NoWarehouses, WarehouseSelect } from './parts';
import { type StockRow, useStock, useWarehouses } from './queries';

/**
 * `/stock`: what is in stock, per item, in one warehouse or summed over the company.
 * `/stock/below-reorder` is the same list kept to the items to order, with how much to order.
 * State in the address, as every list (B16).
 */
export function StockPage({ below = false }: { below?: boolean }) {
  const { t } = useTranslation('warehouse');
  const quantity = useQuantity();
  const warehouses = useWarehouses();
  const list = useListParams(['warehouse', 'zero', 'asOf'], { field: 'code', direction: 'asc' });
  const warehouseId = list.filters.warehouse || undefined;
  const includeZero = !below && list.filters.zero === 'true';
  const asOf = below ? undefined : list.filters.asOf || undefined;
  const stock = useStock({
    page: list.page,
    q: list.q || undefined,
    sort: `${list.sort.field}:${list.sort.direction}`,
    warehouseId,
    belowReorder: below || undefined,
    includeZero: includeZero || undefined,
    asOf,
  });

  const header = (
    <PageHeader
      title={t(below ? 'below.title' : 'stock.title')}
      description={t(below ? 'below.description' : 'stock.description')}
    />
  );
  if (warehouses.data && warehouses.data.items.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <NoWarehouses />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <FilterBar
        activeCount={(warehouseId ? 1 : 0) + (includeZero ? 1 : 0) + (asOf ? 1 : 0)}
        search={
          <SearchInput
            value={list.q}
            onSearch={list.setQuery}
            label={t('stock.search')}
            placeholder={t('stock.search')}
          />
        }
      >
        <WarehouseSelect
          aria-label={t('common.warehouse')}
          warehouses={warehouses.data?.items ?? []}
          value={warehouseId ?? ''}
          onChange={(value) => list.setFilter('warehouse', value || undefined)}
          allowAll
        />
        {!below && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeZero}
                onCheckedChange={(checked) => list.setFilter('zero', checked ? 'true' : undefined)}
              />
              {t('stock.showZero')}
            </label>
            <label className="flex items-center gap-2 text-sm" title={t('stock.asOfHint')}>
              <span className="text-muted-foreground">{t('stock.asOf')}</span>
              <Input
                type="date"
                className="w-auto"
                value={asOf ?? ''}
                onChange={(event) => list.setFilter('asOf', event.target.value || undefined)}
              />
            </label>
          </>
        )}
      </FilterBar>
      <DataTable
        rows={stock.data?.items}
        rowKey={(row) => row.itemId}
        isLoading={stock.isPending}
        error={stock.error}
        emptyTitle={t(below ? 'below.empty' : 'stock.empty')}
        page={stock.data?.page ?? list.page}
        pageSize={stock.data?.pageSize ?? 25}
        total={stock.data?.total ?? 0}
        onPageChange={list.setPage}
        sort={list.sort}
        onSortChange={list.setSort}
        columns={[
          {
            key: 'code',
            header: t('stock.columns.code'),
            sortField: 'code',
            card: 'title',
            cell: (row) => (
              <Link
                to={`/stock/items/${row.itemId}`}
                className="font-mono font-medium underline-offset-4 after:absolute after:inset-0 hover:underline md:after:hidden"
              >
                {row.itemCode}
              </Link>
            ),
          },
          {
            key: 'description',
            header: t('stock.columns.description'),
            sortField: 'description',
            card: 'subtitle',
            className: 'max-w-md truncate',
            cell: (row) => row.itemDescription,
          },
          {
            key: 'quantity',
            header: t('stock.columns.quantity'),
            sortField: 'quantity',
            card: 'detail',
            className: 'text-right tabular-nums',
            cell: (row) => (
              <span className="font-medium">
                {quantity(row.quantity, row.unitDecimals)}{' '}
                <span className="text-muted-foreground font-normal">{row.unit}</span>
              </span>
            ),
          },
          // Reserved and available exist for today's stock only: reservations have no history.
          ...(asOf
            ? []
            : [
                {
                  key: 'reserved',
                  header: t('stock.columns.reserved'),
                  tablet: false,
                  className: 'text-right tabular-nums',
                  cell: (row: StockRow) =>
                    row.reservedQuantity === null || row.reservedQuantity === '0.000'
                      ? ''
                      : quantity(row.reservedQuantity, row.unitDecimals),
                },
                {
                  key: 'available',
                  header: t('stock.columns.available'),
                  card: 'detail' as const,
                  className: 'text-right tabular-nums',
                  cell: (row: StockRow) =>
                    row.availableQuantity === null
                      ? ''
                      : t('stock.availableCell', {
                          quantity: quantity(row.availableQuantity, row.unitDecimals),
                        }),
                },
              ]),
          {
            key: 'reorderPoint',
            header: t('stock.columns.reorderPoint'),
            tablet: false,
            className: 'text-right tabular-nums',
            cell: (row) =>
              row.reorderPoint === null ? '' : quantity(row.reorderPoint, row.unitDecimals),
          },
          ...(below
            ? [
                {
                  key: 'reorderQuantity',
                  header: t('below.reorderQuantity'),
                  card: 'detail' as const,
                  className: 'text-right tabular-nums',
                  cell: (row: StockRow) =>
                    row.reorderQuantity === null
                      ? ''
                      : `${quantity(row.reorderQuantity, row.unitDecimals)} ${row.unit}`,
                },
              ]
            : []),
          {
            key: 'state',
            header: t('stock.columns.state'),
            card: 'detail',
            cell: (row) => (
              <span className="flex flex-wrap gap-1">
                {row.belowReorder && <BelowBadge />}
                {row.itemArchived && <Badge variant="secondary">{t('common.itemArchived')}</Badge>}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
