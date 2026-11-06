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
  ShieldCheckIcon,
  TriangleAlertIcon,
  TruckIcon,
  UserCogIcon,
  UsersIcon,
  WarehouseIcon,
  type LucideIcon,
} from 'lucide-react';
import { matchPath } from 'react-router';

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
    | 'companies'
    | 'members'
    | 'roles'
    | 'activity';
  icon: LucideIcon;
  /** Shown only with this permission. The API still checks it on every call (F18). */
  permission?: string;
  /** Shown only when the tenant has enabled this module. */
  module?: string;
  /** Shown only when the tenant has enabled all these modules. */
  modules?: string[];
  /** Other addresses that belong to this item (a page reached from its list). */
  also?: string[];
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
        to: '/settings/companies',
        label: 'companies',
        icon: Building2Icon,
        permission: 'companies:manage',
        also: ['/settings/company'],
      },
      { to: '/members', label: 'members', icon: UserCogIcon, permission: 'members:read' },
      { to: '/roles', label: 'roles', icon: ShieldCheckIcon, permission: 'members:read' },
      { to: '/activity', label: 'activity', icon: ActivityIcon, permission: 'audit:read' },
    ],
  },
];

/**
 * The item of the current address: the most specific one whose path the address starts with.
 * `/stock/documents` belongs to "Movements" only, not also to "Stock" (`/stock`), while an item's
 * own pages (`/stock/items/…`) keep their item lit.
 */
export function activeItemPath(groups: readonly NavGroup[], pathname: string): string | null {
  let best: { path: string; to: string } | null = null;
  for (const item of groups.flatMap((group) => group.items)) {
    for (const path of [item.to, ...(item.also ?? [])]) {
      if (!matchPath({ path, end: path === '/' }, pathname)) continue;
      if (!best || path.length > best.path.length) best = { path, to: item.to };
    }
  }
  return best?.to ?? null;
}

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
