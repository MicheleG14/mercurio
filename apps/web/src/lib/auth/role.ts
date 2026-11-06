import { useTranslation } from 'react-i18next';
import type { components } from '@/api/schema';

export type RoleRef = components['schemas']['RoleRefDto'];
export type BuiltinRole = NonNullable<RoleRef['key']>;

/**
 * How a role reads in the interface: a built-in one in the current language, a custom one with the
 * name the tenant gave it (docs/adr/0036).
 */
export function useRoleLabel() {
  const { t } = useTranslation('auth');
  return (role: RoleRef | null | undefined): string => {
    if (!role) return '';
    return role.kind === 'builtin' && role.key ? t(`roles.${role.key}`) : (role.name ?? '');
  };
}

/** A built-in role as the API describes it, for fixtures and defaults. */
export const builtinRole = (key: BuiltinRole): RoleRef => ({
  kind: 'builtin',
  key,
  id: null,
  name: null,
});
