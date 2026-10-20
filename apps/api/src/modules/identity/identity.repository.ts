import { Injectable } from '@nestjs/common';
import type { MembershipRole } from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';

/**
 * The only code that touches the identity tables (B2, B3). Queries on memberships always
 * filter by tenant explicitly, as in TenancyRepository: the owner role used by terminal
 * commands is not restricted by Row-Level Security.
 */
@Injectable()
export class IdentityRepository {
  findUserByEmail(db: DbClient, email: string) {
    return db.user.findUnique({ where: { email } });
  }

  findUserById(db: DbClient, id: string) {
    return db.user.findUnique({ where: { id } });
  }

  /** The person's active memberships, in every tenant (policy own_memberships). */
  listActiveMemberships(db: DbClient, userId: string) {
    return db.membership.findMany({ where: { userId, status: 'ACTIVE' } });
  }

  findMembershipWithCompanies(db: DbClient, tenantId: string, userId: string) {
    return db.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { companies: { select: { companyId: true } } },
    });
  }

  createUser(db: DbClient, data: { email: string; name: string }) {
    return db.user.create({ data });
  }

  findMembership(db: DbClient, tenantId: string, userId: string) {
    return db.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
  }

  createMembership(
    db: DbClient,
    data: { tenantId: string; userId: string; role: MembershipRole; allCompanies: boolean },
  ) {
    return db.membership.create({ data });
  }

  updateMembership(
    db: DbClient,
    tenantId: string,
    id: string,
    data: { role?: MembershipRole; allCompanies?: boolean; status?: 'ACTIVE' | 'REMOVED' },
  ) {
    return db.membership.update({ where: { tenantId_id: { tenantId, id } }, data });
  }

  /** The companies listed for a membership become exactly `companyIds`. */
  async replaceMembershipCompanies(
    db: DbClient,
    tenantId: string,
    membershipId: string,
    companyIds: readonly string[],
  ) {
    await db.membershipCompany.deleteMany({ where: { tenantId, membershipId } });
    await db.membershipCompany.createMany({
      data: companyIds.map((companyId) => ({ tenantId, membershipId, companyId })),
    });
  }

  listMembers(db: DbClient, tenantId: string) {
    return db.membership.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { user: true, companies: { select: { companyId: true } } },
    });
  }

  /** A new code replaces any unused one of the same user. */
  async replaceActivationToken(
    db: DbClient,
    data: { userId: string; tokenHash: string; expiresAt: Date },
  ) {
    await db.activationToken.deleteMany({ where: { userId: data.userId, usedAt: null } });
    await db.activationToken.create({ data });
  }
}
