import {
  ActivityIcon,
  ArrowLeftRightIcon,
  BoxesIcon,
  HouseIcon,
  PackageIcon,
  TriangleAlertIcon,
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
    | 'activity';
  icon: LucideIcon;
  /** Shown only with this permission. The API still checks it on every call (F18). */
  permission?: string;
  /** Shown only when the tenant has enabled this module. */
  module?: string;
}

export interface NavGroup {
  /** Key under `nav.group.` in the common translations; none for the top items. */
  label?: 'registry' | 'warehouse' | 'administration';
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
    label: 'administration',
    items: [{ to: '/activity', label: 'activity', icon: ActivityIcon, permission: 'audit:read' }],
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
        (!item.module || me?.modules.includes(item.module)),
    ),
  })).filter((group) => group.items.length > 0);
}
