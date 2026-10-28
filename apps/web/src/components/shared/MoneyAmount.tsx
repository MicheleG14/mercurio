import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/decimal';
import { cn } from '@/lib/utils';

/**
 * An amount in euro as people read it, "1.234,50 €" in Italian: two decimals for amounts, up to
 * four for unit prices (`price`). Figures line up in columns (tabular numbers).
 */
export function MoneyAmount({
  value,
  price = false,
  className,
}: {
  /** A decimal string of the API (B30). */
  value: string;
  price?: boolean;
  className?: string;
}) {
  const { i18n } = useTranslation();
  return (
    <span className={cn('tabular-nums', className)}>
      {formatMoney(value, i18n.language, price ? 4 : 2)}
    </span>
  );
}
