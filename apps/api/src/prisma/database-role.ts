import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * True when the connected role ignores Row-Level Security: a superuser, or a role with
 * BYPASSRLS. Tenant isolation is enforced by the database, so this would silently turn it
 * off. The API must run as mercurio_app (docs/conventions.md B26).
 */
export async function canBypassRowLevelSecurity(
  prisma: Pick<PrismaClient, '$queryRaw'>,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ bypass: boolean }[]>`
    SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
  // No row means the role cannot be inspected: treat it as unsafe.
  return rows[0]?.bypass !== false;
}

export const ROLE_BYPASSES_RLS_MESSAGE =
  'The database role can bypass Row-Level Security (superuser or BYPASSRLS): ' +
  'tenant data would not be isolated. DATABASE_URL must use the mercurio_app role.';
