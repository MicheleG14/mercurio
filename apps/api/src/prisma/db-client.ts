import { Prisma } from '../generated/prisma/client.js';

/**
 * What repositories receive: the raw client or a transaction (from TenantDatabase, or opened by
 * a command that spans several modules). Passing it explicitly keeps transaction boundaries
 * visible in the code (docs/conventions.md B12).
 */
export type DbClient = Prisma.TransactionClient;

/** True when a write failed on a unique constraint (Prisma error P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
