import { PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { DataTable } from '@/components/shared/DataTable';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { decimalToInput, parseDecimalInput, quantityLimits } from '@/lib/decimal';
import { formatDate } from '@/lib/format';
import { useQuantity, useWarehouseRights } from './hooks';
import { BelowBadge, WarehouseSelect } from './parts';
import {
  type ItemStock,
  useItemStock,
  useMovements,
  useRemoveReorderLevel,
  useSetReorderLevel,
  useWarehouses,
} from './queries';

type WarehouseStock = ItemStock['warehouses'][number];

/** `/stock/items/:itemId`: an item's stock in each warehouse, its reorder levels and history. */
export function ItemStockPage() {
  const { itemId = '' } = useParams();
  const { t } = useTranslation('warehouse');
  const quantity = useQuantity();
  const stock = useItemStock(itemId);

  if (stock.isPending) return <Skeleton className="h-64 w-full" />;
  if (stock.error) return <ErrorMessage error={stock.error} />;
  const item = stock.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${item.itemCode} · ${item.itemDescription}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {item.itemArchived && <Badge variant="secondary">{t('common.itemArchived')}</Badge>}
            <Link to={`/items/${item.itemId}`} className={buttonVariants({ variant: 'outline' })}>
              {t('item.openRegistry')}
            </Link>
          </div>
        }
      />
      {!item.stockManaged && <Alert>{t('item.notStockManaged')}</Alert>}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">{t('item.byWarehouse')}</h2>
          <span className="text-sm">
            {t('item.total')}:{' '}
            <span className="font-semibold tabular-nums">
              {quantity(item.quantity, item.unitDecimals)} {item.unit}
            </span>
          </span>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {item.warehouses.map((warehouse) => (
            <WarehouseCard key={warehouse.warehouseId} item={item} warehouse={warehouse} />
          ))}
        </ul>
      </section>

      <History item={item} />
    </div>
  );
}

/** One warehouse: its stock, and the reorder level, changed in place. */
function WarehouseCard({ item, warehouse }: { item: ItemStock; warehouse: WarehouseStock }) {
  const { t, i18n } = useTranslation('warehouse');
  const { t: tc } = useTranslation();
  const { t: tError } = useTranslation('errors');
  const quantity = useQuantity();
  const { write } = useWarehouseRights();
  const set = useSetReorderLevel();
  const remove = useRemoveReorderLevel();
  const [editing, setEditing] = useState(false);
  const [point, setPoint] = useState('');
  const [toOrder, setToOrder] = useState('');
  const [invalid, setInvalid] = useState<'point' | 'toOrder' | null>(null);
  const limits = quantityLimits(item.unitDecimals);
  const show = (value: string | null) =>
    value === null ? '' : `${quantity(value, item.unitDecimals)} ${item.unit}`;

  const open = () => {
    setPoint(decimalToInput(warehouse.reorderPoint, i18n.language, 0));
    setToOrder(decimalToInput(warehouse.reorderQuantity, i18n.language, 0));
    setInvalid(null);
    set.reset();
    setEditing(true);
  };
  const save = () => {
    const reorderPoint = parseDecimalInput(point, i18n.language, limits);
    const reorderQuantity = parseDecimalInput(toOrder, i18n.language, limits);
    if (!reorderPoint) return setInvalid('point');
    if (reorderQuantity === undefined) return setInvalid('toOrder');
    set.mutate(
      {
        warehouseId: warehouse.warehouseId,
        itemId: item.itemId,
        reorderPoint,
        reorderQuantity,
        version: warehouse.reorderVersion ?? undefined,
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <li className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-medium">{warehouse.warehouseCode}</div>
          <div className="text-muted-foreground text-sm">{warehouse.warehouseName}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums">{show(warehouse.quantity)}</div>
          {warehouse.belowReorder && <BelowBadge />}
        </div>
      </div>
      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label={`${t('item.reorder.point')} (${item.unit})`}
              hint={t('item.reorder.hint')}
              error={invalid === 'point' ? tError('validation.quantity') : undefined}
            >
              {(p) => (
                <DecimalInput {...p} value={point} onChange={(e) => setPoint(e.target.value)} />
              )}
            </FormField>
            <FormField
              label={`${t('item.reorder.quantity')} (${item.unit})`}
              error={invalid === 'toOrder' ? tError('validation.quantity') : undefined}
            >
              {(p) => (
                <DecimalInput {...p} value={toOrder} onChange={(e) => setToOrder(e.target.value)} />
              )}
            </FormField>
          </div>
          <ErrorMessage error={set.error ?? remove.error} />
          <div className="flex flex-wrap justify-end gap-2">
            {warehouse.reorderVersion !== null && (
              <Button
                variant="ghost"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(
                    {
                      warehouseId: warehouse.warehouseId,
                      itemId: item.itemId,
                      version: warehouse.reorderVersion!,
                    },
                    { onSuccess: () => setEditing(false) },
                  )
                }
              >
                {t('item.reorder.remove')}
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(false)}>
              {tc('actions.cancel')}
            </Button>
            <Button disabled={set.isPending} onClick={save}>
              {tc('actions.save')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {warehouse.reorderPoint === null
              ? t('item.reorder.none')
              : `${t('item.reorder.point')}: ${show(warehouse.reorderPoint)}${
                  warehouse.reorderQuantity
                    ? ` · ${t('item.reorder.quantity')}: ${show(warehouse.reorderQuantity)}`
                    : ''
                }`}
          </span>
          {write && item.stockManaged && !warehouse.warehouseArchived && (
            <Button variant="ghost" size="sm" onClick={open}>
              <PencilIcon data-icon="inline-start" />
              {t(warehouse.reorderPoint === null ? 'item.reorder.set' : 'item.reorder.edit')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** The item's movements, newest first, with the stock right after each. */
function History({ item }: { item: ItemStock }) {
  const { t, i18n } = useTranslation('warehouse');
  const quantity = useQuantity();
  const warehouses = useWarehouses();
  const [page, setPage] = useState(1);
  const [warehouseId, setWarehouseId] = useState('');
  const movements = useMovements(item.itemId, { page, warehouseId: warehouseId || undefined });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t('item.history')}</h2>
        <WarehouseSelect
          aria-label={t('common.warehouse')}
          warehouses={warehouses.data?.items ?? []}
          value={warehouseId}
          onChange={(value) => {
            setWarehouseId(value);
            setPage(1);
          }}
          allowAll
        />
      </div>
      <DataTable
        rows={movements.data?.items}
        rowKey={(row) => row.id}
        isLoading={movements.isPending}
        error={movements.error}
        emptyTitle={t('item.historyEmpty')}
        page={movements.data?.page ?? page}
        pageSize={movements.data?.pageSize ?? 25}
        total={movements.data?.total ?? 0}
        onPageChange={setPage}
        columns={[
          {
            key: 'date',
            header: t('item.columns.date'),
            card: 'subtitle',
            className: 'tabular-nums',
            cell: (row) => formatDate(row.movementDate, i18n.language),
          },
          {
            key: 'document',
            header: t('item.columns.document'),
            card: 'title',
            cell: (row) => (
              <Link
                to={`/stock/documents/${row.documentId}`}
                className="font-mono underline-offset-4 after:absolute after:inset-0 hover:underline md:after:hidden"
              >
                {row.reference}
              </Link>
            ),
          },
          {
            key: 'reason',
            header: t('item.columns.reason'),
            card: 'subtitle',
            cell: (row) => t(`reason.${row.reason as 'OPENING'}`),
          },
          {
            key: 'warehouse',
            header: t('item.columns.warehouse'),
            tablet: false,
            cell: (row) => <span className="font-mono">{row.warehouseCode}</span>,
          },
          {
            key: 'movement',
            header: t('item.columns.movement'),
            card: 'detail',
            className: 'text-right tabular-nums',
            cell: (row) => (
              <span className={row.quantity.startsWith('-') ? undefined : 'text-success'}>
                {row.quantity.startsWith('-') ? '' : '+'}
                {quantity(row.quantity, item.unitDecimals)}
              </span>
            ),
          },
          {
            key: 'balance',
            header: t('item.columns.balance'),
            card: 'detail',
            className: 'text-right font-medium tabular-nums',
            cell: (row) => `${quantity(row.balance, item.unitDecimals)} ${item.unit}`,
          },
        ]}
      />
    </section>
  );
}
