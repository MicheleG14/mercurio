import { useTranslation } from 'react-i18next';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { Badge } from '@/components/ui/badge';
import type { PaymentStatus } from './queries';

/** Paid or not, in words (F5: never colour alone), with "overdue" next to it when it applies. */
export function PaymentStatusBadges({
  status,
  overdue,
}: {
  status: PaymentStatus;
  overdue: boolean;
}) {
  const { t } = useTranslation('invoicing');
  const variant =
    status === 'PAID' || status === 'REFUNDED' || status === 'SETTLED'
      ? 'success'
      : status === 'CREDITED'
        ? 'secondary'
        : 'default';
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant={variant}>{t(`paymentStatus.${status}`)}</Badge>
      {overdue && <Badge variant="warning">{t('overdue')}</Badge>}
    </span>
  );
}

/** Taxable, VAT per rate and total, of a document or of a draft being typed. */
export function DocumentTotals({
  rows,
  taxableTotal,
  vatTotal,
  total,
  stampDuty,
}: {
  rows: { vatCode: string; rate: string; nature?: string | null; taxable: string; vat: string }[];
  taxableTotal: string;
  vatTotal: string;
  total: string;
  stampDuty?: string;
}) {
  const { t } = useTranslation('invoicing');
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
            {t('totals.vatRow', { code: row.rate === '0.00' ? row.vatCode : `${row.vatCode}%` })}{' '}
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
      {stampDuty && stampDuty !== '0.00' && (
        <div className="text-muted-foreground flex justify-between gap-4 text-xs">
          <dt>{t('totals.stampDuty')}</dt>
          <dd>
            <MoneyAmount value={stampDuty} />
          </dd>
        </div>
      )}
    </dl>
  );
}
