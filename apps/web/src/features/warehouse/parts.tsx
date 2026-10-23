import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState } from '@/components/shared/EmptyState';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useWarehouseRights } from './hooks';
import type { Warehouse } from './queries';

// Small pieces the warehouse screens share.

export function BelowBadge() {
  const { t } = useTranslation('warehouse');
  return <Badge variant="warning">{t('common.below')}</Badge>;
}

/** A select of the company's active warehouses, optionally with "all of them". */
export function WarehouseSelect({
  warehouses,
  value,
  onChange,
  allowAll,
  id,
  ...aria
}: {
  warehouses: Warehouse[];
  value: string;
  onChange: (value: string) => void;
  allowAll?: boolean;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const { t } = useTranslation('warehouse');
  return (
    <NativeSelect
      id={id}
      className="w-full md:w-auto"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...aria}
    >
      {allowAll && <NativeSelectOption value="">{t('common.allWarehouses')}</NativeSelectOption>}
      {warehouses.map((warehouse) => (
        <NativeSelectOption key={warehouse.id} value={warehouse.id}>
          {warehouse.code} · {warehouse.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Shown instead of a screen when the company has no warehouse yet. */
export function NoWarehouses() {
  const { t } = useTranslation('warehouse');
  const { manage } = useWarehouseRights();
  return (
    <EmptyState title={t('common.noWarehouses')}>
      {manage ? (
        <Link
          to="/warehouses"
          className={buttonVariants({ variant: 'outline', className: 'mt-3' })}
        >
          {t('common.createWarehouse')}
        </Link>
      ) : (
        <p>{t('common.askAdmin')}</p>
      )}
    </EmptyState>
  );
}
