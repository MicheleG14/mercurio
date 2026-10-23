import { useTranslation } from 'react-i18next';
import { useMe } from '@/lib/auth/me';
import { formatQuantity } from '@/lib/decimal';

/** Formats quantities in the person's language with the decimals of the unit (F10). */
export function useQuantity() {
  const { i18n } = useTranslation();
  return (value: string, decimals = 3) => formatQuantity(value, i18n.language, decimals);
}

/** What the person may do in the warehouse: the API checks it again on every call (F18). */
export function useWarehouseRights() {
  const permissions = useMe().data?.permissions ?? [];
  return {
    write: permissions.includes('stock:write'),
    manage: permissions.includes('warehouses:manage'),
  };
}
