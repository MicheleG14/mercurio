import { useTranslation } from 'react-i18next';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { Badge } from '@/components/ui/badge';
import type { OrderKind, OrderStatus } from './queries';

/**
 * The status of an order in words (F5: never colour alone), with "late" and "uncovered" next to
 * it when they apply. The words depend on the kind: a purchase is "received", a sale "shipped".
 */
export function OrderStatusBadges({
  kind,
  status,
  late,
  uncovered,
}: {
  kind: OrderKind;
  status: OrderStatus;
  late: boolean;
  uncovered: boolean;
}) {
  const { t } = useTranslation('orders');
  const variant =
    status === 'COMPLETED'
      ? 'success'
      : status === 'CANCELLED' || status === 'DRAFT'
        ? 'secondary'
        : 'default';
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant={variant}>{t(`status.${kind}.${status}`)}</Badge>
      {late && <Badge variant="warning">{t('status.late')}</Badge>}
      {uncovered && <Badge variant="warning">{t('status.uncovered')}</Badge>}
    </span>
  );
}

/** Taxable, VAT per rate and total: of a saved order, or a preview of the form being typed. */
export function OrderTotals({
  rows,
  taxableTotal,
  vatTotal,
  total,
}: {
  rows: { vatCode: string; rate: string; taxable: string; vat: string }[];
  taxableTotal: string;
  vatTotal: string;
  total: string;
}) {
  const { t } = useTranslation('orders');
  return (
    <dl className="border-border ml-auto flex w-full max-w-sm flex-col gap-1 border-t pt-3 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">{t('totals.taxable')}</dt>
        <dd>
          <MoneyAmount value={taxableTotal} />
        </dd>
      </div>
      {rows.map((row) => (
        <div key={row.vatCode} className="flex justify-between gap-4">
          <dt className="text-muted-foreground">
            {t('totals.vatRow', { code: row.vatCode })}{' '}
            <MoneyAmount value={row.taxable} className="text-xs" />
          </dt>
          <dd>
            <MoneyAmount value={row.vat} />
          </dd>
        </div>
      ))}
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">{t('totals.vat')}</dt>
        <dd>
          <MoneyAmount value={vatTotal} />
        </dd>
      </div>
      <div className="flex justify-between gap-4 text-base font-semibold">
        <dt>{t('totals.total')}</dt>
        <dd>
          <MoneyAmount value={total} />
        </dd>
      </div>
    </dl>
  );
}
