import {
  ActivityIcon,
  ArrowLeftRightIcon,
  BanknoteIcon,
  Building2Icon,
  CalendarClockIcon,
  FilePlusIcon,
  FileTextIcon,
  BoxesIcon,
  ClipboardListIcon,
  HouseIcon,
  PackageIcon,
  TriangleAlertIcon,
  TruckIcon,
  UsersIcon,
  WarehouseIcon,
  type LucideIcon,
} from 'lucide-react';

/**
 * The menu, described once (docs/conventions.md F22): the sidebar, its icons-only form and the
 * panel of phones and tablets are all drawn from this list. A module adds its screens here, in
 * its own group, and they appear only to tenants that enabled it and people allowed to see them.
 */
export interface NavItem {
  to: string;
  /** Key under `nav.` in the common translations. */
  label:
    | 'home'
    | 'parties'
    | 'items'
    | 'stock'
    | 'stockDocuments'
    | 'belowReorder'
    | 'warehouses'
    | 'salesOrders'
    | 'purchaseOrders'
    | 'invoices'
    | 'toInvoice'
    | 'dueDates'
    | 'payments'
    | 'company'
    | 'activity';
  icon: LucideIcon;
  /** Shown only with this permission. The API still checks it on every call (F18). */
  permission?: string;
  /** Shown only when the tenant has enabled this module. */
  module?: string;
  /** Shown only when the tenant has enabled all these modules. */
  modules?: string[];
}

export interface NavGroup {
  /** Key under `nav.group.` in the common translations; none for the top items. */
  label?: 'registry' | 'warehouse' | 'orders' | 'invoicing' | 'administration';
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  { items: [{ to: '/', label: 'home', icon: HouseIcon }] },
  {
    label: 'registry',
    items: [
      {
        to: '/parties',
        label: 'parties',
        icon: UsersIcon,
        permission: 'parties:read',
        module: 'registry',
      },
      {
        to: '/items',
        label: 'items',
        icon: PackageIcon,
        permission: 'items:read',
        module: 'registry',
      },
    ],
  },
  {
    label: 'warehouse',
    items: [
      {
        to: '/stock',
        label: 'stock',
        icon: BoxesIcon,
        permission: 'stock:read',
        module: 'warehouse',
      },
      {
        to: '/stock/documents',
        label: 'stockDocuments',
        icon: ArrowLeftRightIcon,
        permission: 'stock:read',
        module: 'warehouse',
      },
      {
        to: '/stock/below-reorder',
        label: 'belowReorder',
        icon: TriangleAlertIcon,
        permission: 'stock:read',
        module: 'warehouse',
      },
      {
        to: '/warehouses',
        label: 'warehouses',
        icon: WarehouseIcon,
        permission: 'warehouses:manage',
        module: 'warehouse',
      },
    ],
  },
  {
    label: 'orders',
    items: [
      {
        to: '/orders/sales',
        label: 'salesOrders',
        icon: ClipboardListIcon,
        permission: 'orders:read',
        module: 'orders',
      },
      {
        to: '/orders/purchase',
        label: 'purchaseOrders',
        icon: TruckIcon,
        permission: 'orders:read',
        module: 'orders',
      },
    ],
  },
  {
    label: 'invoicing',
    items: [
      {
        to: '/invoicing/invoices',
        label: 'invoices',
        icon: FileTextIcon,
        permission: 'invoicing:read',
        module: 'invoicing',
      },
      {
        to: '/invoicing/to-invoice',
        label: 'toInvoice',
        icon: FilePlusIcon,
        permission: 'invoicing:read',
        // Shipments come from orders: without them there is nothing to invoice from here.
        modules: ['invoicing', 'orders'],
      },
      {
        to: '/invoicing/due-dates',
        label: 'dueDates',
        icon: CalendarClockIcon,
        permission: 'invoicing:read',
        module: 'invoicing',
      },
      {
        to: '/invoicing/payments',
        label: 'payments',
        icon: BanknoteIcon,
        permission: 'invoicing:read',
        module: 'invoicing',
      },
    ],
  },
  {
    label: 'administration',
    items: [
      {
        to: '/settings/company',
        label: 'company',
        icon: Building2Icon,
        permission: 'companies:manage',
      },
      { to: '/activity', label: 'activity', icon: ActivityIcon, permission: 'audit:read' },
    ],
  },
];

/** The groups and items a person may see, without groups left empty. */
export function visibleNavigation(
  me: { permissions: readonly string[]; modules: readonly string[] } | undefined,
): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.permission || me?.permissions.includes(item.permission)) &&
        (!item.module || me?.modules.includes(item.module)) &&
        (item.modules ?? []).every((key) => me?.modules.includes(key)),
    ),
  })).filter((group) => group.items.length > 0);
}
