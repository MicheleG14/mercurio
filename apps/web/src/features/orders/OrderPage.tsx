import {
  CopyIcon,
  PackageCheckIcon,
  PencilIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { PageHeader } from '@/components/shared/PageHeader';
import { ProgressCell } from '@/components/shared/ProgressCell';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatTime } from '@/lib/format';
import { uuidv7 } from '@/lib/uuid';
import { useOrderRights, useQuantity } from './hooks';
import { vatShortLabel } from './order-form';
import { OrderStatusBadges, OrderTotals } from './parts';
import { type Order, type OrderLine, useDeleteOrder, useOrder, useOrderAction } from './queries';

/** `/orders/:id`: an order, its lines and how far they got, and what can be done with it. */
export function OrderPage() {
  const { id = '' } = useParams();
  const order = useOrder(id);
  if (order.isPending) return <Skeleton className="h-64 w-full" />;
  if (order.error) return <ErrorMessage error={order.error} />;
  return <OrderView order={order.data} />;
}

type Asking = 'delete' | 'close' | 'cancel' | { reverse: string } | null;

function OrderView({ order }: { order: Order }) {
  const { t, i18n } = useTranslation('orders');
  const navigate = useNavigate();
  const { write, fulfil } = useOrderRights();
  const action = useOrderAction(order.id);
  const remove = useDeleteOrder(order.id);
  const [asking, setAsking] = useState<Asking>(null);
  const date = (value: string) => formatDate(value, i18n.language);
  const draft = order.status === 'DRAFT';
  const open = order.status === 'CONFIRMED' || order.status === 'PARTIAL';
  const sales = order.kind === 'SALES';
  const active = order.fulfilments.filter((f) => f.reversalDocumentId === null);
  const list = `/orders/${sales ? 'sales' : 'purchase'}`;

  const run = (input: Parameters<typeof action.mutate>[0], then?: (order: Order) => void) =>
    action.mutate(input, {
      onSuccess: (result) => {
        setAsking(null);
        then?.(result as Order);
      },
      onError: () => setAsking(null),
    });

  const details: [string, ReactNode][] = [
    [t('detail.orderDate'), date(order.orderDate)],
    [t(`form.fields.party.${order.kind}`), order.partyName],
    [
      t(`form.fields.warehouse.${order.kind}`),
      order.warehouseCode ? (
        <span key="warehouse">
          <span className="font-mono">{order.warehouseCode}</span> {order.warehouseName}
        </span>
      ) : (
        '—'
      ),
    ],
    [t('form.fields.requestedDate'), order.requestedDate ? date(order.requestedDate) : '—'],
    ...(order.partyReference
      ? [
          [
            t(`form.fields.partyReference.${order.kind}`),
            order.partyReferenceDate
              ? `${order.partyReference} · ${date(order.partyReferenceDate)}`
              : order.partyReference,
          ] as [string, ReactNode],
        ]
      : []),
    [t('detail.createdBy'), order.createdByName ?? '—'],
    ...(order.confirmedAt
      ? [
          [
            t('detail.confirmedAt'),
            `${date(order.confirmedAt.slice(0, 10))} ${formatTime(order.confirmedAt, i18n.language)}`,
          ] as [string, ReactNode],
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          order.reference
            ? t('detail.title', { reference: order.reference })
            : t('detail.draftTitle')
        }
        description={t(`detail.kind.${order.kind}`)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadges
              kind={order.kind}
              status={order.status}
              late={order.late}
              uncovered={order.uncovered}
            />
            {draft && write && (
              <>
                <Link
                  to={`/orders/${order.id}/edit`}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  <PencilIcon data-icon="inline-start" />
                  {t('actions.edit')}
                </Link>
                <Button
                  onClick={() => run({ type: 'confirm', version: order.version })}
                  disabled={action.isPending}
                >
                  <ShieldCheckIcon data-icon="inline-start" />
                  {t('actions.confirm')}
                </Button>
                <Button variant="outline" onClick={() => setAsking('delete')}>
                  <Trash2Icon data-icon="inline-start" />
                  {t('actions.delete')}
                </Button>
              </>
            )}
            {open && fulfil && (
              <Link to={`/orders/${order.id}/fulfil`} className={buttonVariants()}>
                <PackageCheckIcon data-icon="inline-start" />
                {t(`actions.fulfil.${order.kind}`)}
              </Link>
            )}
            {open && write && sales && order.uncovered && (
              <Button
                variant="outline"
                onClick={() => run({ type: 'reserve' })}
                disabled={action.isPending}
              >
                {t('actions.reserve')}
              </Button>
            )}
            {open && write && (
              <Button variant="outline" onClick={() => setAsking('close')}>
                <XCircleIcon data-icon="inline-start" />
                {t('actions.close')}
              </Button>
            )}
            {open && write && active.length === 0 && (
              <Button variant="outline" onClick={() => setAsking('cancel')}>
                {t('actions.cancel')}
              </Button>
            )}
            {!draft && write && (
              <Button
                variant="outline"
                onClick={() =>
                  run({ type: 'duplicate', newId: uuidv7() }, (copy) =>
                    navigate(`/orders/${copy.id}/edit`),
                  )
                }
                disabled={action.isPending}
              >
                <CopyIcon data-icon="inline-start" />
                {t('actions.duplicate')}
              </Button>
            )}
          </div>
        }
      />
      <ErrorMessage error={action.error ?? remove.error} />

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {details.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      {order.notes && (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">{t('form.fields.notes')}</span>
          <p className="text-sm whitespace-pre-line">{order.notes}</p>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t('form.section.lines')}</h2>
        {order.lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('detail.noLines')}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {order.lines.map((line) => (
              <LineCard key={line.id} order={order} line={line} />
            ))}
          </ol>
        )}
        <OrderTotals
          rows={order.vatSummary}
          taxableTotal={order.taxableTotal}
          vatTotal={order.vatTotal}
          total={order.total}
        />
      </section>

      {order.fulfilments.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t(`detail.fulfilments.${order.kind}`)}</h2>
          <ul className="border-border divide-border divide-y rounded-lg border">
            {order.fulfilments.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="tabular-nums">{date(f.documentDate)}</span>
                  <Link
                    className="font-mono underline underline-offset-4"
                    to={`/stock/documents/${f.stockDocumentId}`}
                  >
                    {f.stockDocumentReference}
                  </Link>
                  <span className="text-muted-foreground">
                    {t('detail.fulfilmentLines', { count: f.lines.length })}
                    {f.createdByName ? ` · ${f.createdByName}` : ''}
                  </span>
                  {f.reversalDocumentId && (
                    <Badge variant="warning">
                      {t('detail.reversed', { reference: f.reversalDocumentReference ?? '' })}
                    </Badge>
                  )}
                </span>
                {!f.reversalDocumentId && fulfil && (
                  <Button variant="ghost" size="sm" onClick={() => setAsking({ reverse: f.id })}>
                    <RotateCcwIcon data-icon="inline-start" />
                    {t('actions.reverse')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={asking === 'delete'}
        title={t('confirm.delete.title')}
        description={t('confirm.delete.description')}
        confirmLabel={t('actions.delete')}
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(order.version, { onSuccess: () => navigate(list, { replace: true }) })
        }
        onCancel={() => setAsking(null)}
      />
      <ConfirmDialog
        open={asking === 'close'}
        title={t('confirm.close.title', { reference: order.reference ?? '' })}
        description={t(`confirm.close.description.${order.kind}`)}
        confirmLabel={t('actions.close')}
        pending={action.isPending}
        onConfirm={() => run({ type: 'close', version: order.version })}
        onCancel={() => setAsking(null)}
      />
      <ConfirmDialog
        open={asking === 'cancel'}
        title={t('confirm.cancel.title', { reference: order.reference ?? '' })}
        description={t('confirm.cancel.description')}
        confirmLabel={t('actions.cancel')}
        destructive
        pending={action.isPending}
        onConfirm={() => run({ type: 'cancel', version: order.version })}
        onCancel={() => setAsking(null)}
      />
      <ConfirmDialog
        open={typeof asking === 'object' && asking !== null}
        title={t('confirm.reverse.title')}
        description={t(`confirm.reverse.description.${order.kind}`)}
        confirmLabel={t('actions.reverse')}
        destructive
        pending={action.isPending}
        onConfirm={() =>
          typeof asking === 'object' &&
          asking &&
          run({ type: 'reverse', fulfilmentId: asking.reverse })
        }
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}

/** One line: what was ordered and at what price, how much moved, what is reserved and left. */
function LineCard({ order, line }: { order: Order; line: OrderLine }) {
  const { t } = useTranslation('orders');
  const quantity = useQuantity();
  const q = (value: string) => quantity(value, line.unitDecimals);
  const sales = order.kind === 'SALES';
  const confirmed = order.status !== 'DRAFT';
  // Only the width of a bar: the figures shown stay the API's strings (B30).
  const done = Number(line.doneQuantity) / Number(line.quantity);

  return (
    <li className="border-border grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(12rem,1fr)_auto_auto] md:items-center">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm">
          <span className="text-muted-foreground tabular-nums">{line.lineNo}. </span>
          <span className="font-mono">{line.itemCode}</span> {line.description}
        </span>
        <span className="text-muted-foreground text-sm tabular-nums">
          {q(line.quantity)} {line.unit}
          {line.unitPrice && (
            <>
              {' × '}
              <MoneyAmount value={line.unitPrice} price />
              {line.discountPercent !== '0.00' &&
                ` − ${t('detail.discount', { percent: quantity(line.discountPercent, 2) })}`}
            </>
          )}
          {' · '}
          {t('detail.vat', { code: vatShortLabel(line.vatCode, line.vatRate) })}
        </span>
      </div>
      {confirmed ? (
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <ProgressCell
            done={q(line.doneQuantity)}
            total={q(line.quantity)}
            ratio={done}
            label={t(`detail.progress.${order.kind}`, {
              done: q(line.doneQuantity),
              total: q(line.quantity),
            })}
          />
          <span className="flex flex-col">
            <span className="text-muted-foreground text-xs">{t('detail.remaining')}</span>
            <span className="tabular-nums">{q(line.remainingQuantity)}</span>
          </span>
          {sales && (
            <span className="flex flex-col">
              <span className="text-muted-foreground text-xs">{t('detail.reserved')}</span>
              <span className="tabular-nums">{q(line.reservedQuantity)}</span>
            </span>
          )}
          {line.closedQuantity !== '0.000' && (
            <span className="flex flex-col">
              <span className="text-muted-foreground text-xs">{t('detail.closed')}</span>
              <span className="tabular-nums">{q(line.closedQuantity)}</span>
            </span>
          )}
        </div>
      ) : (
        <span />
      )}
      <span className="text-right font-medium">
        {line.lineAmount ? <MoneyAmount value={line.lineAmount} /> : '—'}
      </span>
    </li>
  );
}
