import { HttpStatus, Injectable } from '@nestjs/common';
import { MembershipRole } from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';
import { DomainException } from '../../shared/errors/index.js';
import { normalizeName } from '../../shared/text.js';
import { TenancyService } from '../tenancy/index.js';
import { newActivationCode } from './activation-code.js';
import type { CompanyAccess } from './company-access.js';
import { normalizeEmail } from './email.js';
import { IdentityRepository } from './identity.repository.js';

export const ROLES = Object.values(MembershipRole);

export interface MemberInput {
  tenantId: string;
  email: string;
  name: string;
  role: string;
  /** "all", or the ids of the companies the member can reach. */
  companies: 'all' | readonly string[];
}

/**
 * Public service of the identity module (B3): people, their memberships in tenants and the
 * companies they can reach. Methods take the database client so a caller can combine modules
 * in one transaction (creating a tenant with its first administrator, for example).
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly tenancy: TenancyService,
  ) {}

  /**
   * Adds a person to a tenant. One identity per email across tenants (S4): an existing one is
   * reused and only gets a new membership; a removed membership is reactivated. A new identity
   * gets a one-time activation code, returned once and stored only as a hash.
   */
  async addMember(db: DbClient, input: MemberInput) {
    const email = normalizeEmail(input.email);
    const role = parseRole(input.role);
    const allCompanies = input.companies === 'all';
    const companyIds = allCompanies ? [] : [...new Set(input.companies)];
    if (!allCompanies && companyIds.length === 0) {
      throw new DomainException('MEMBERSHIP_NEEDS_COMPANIES', HttpStatus.BAD_REQUEST);
    }
    await this.tenancy.assertCompaniesInTenant(db, input.tenantId, companyIds);

    let user = await this.repository.findUserByEmail(db, email);
    const identityCreated = !user;
    user ??= await this.repository.createUser(db, { email, name: normalizeName(input.name) });

    const existing = await this.repository.findMembership(db, input.tenantId, user.id);
    if (existing?.status === 'ACTIVE') {
      throw new DomainException('MEMBERSHIP_EXISTS', HttpStatus.CONFLICT, { detail: email });
    }
    const membership = existing
      ? await this.repository.updateMembership(db, input.tenantId, existing.id, {
          role,
          allCompanies,
          status: 'ACTIVE',
        })
      : await this.repository.createMembership(db, {
          tenantId: input.tenantId,
          userId: user.id,
          role,
          allCompanies,
        });
    await this.repository.replaceMembershipCompanies(db, input.tenantId, membership.id, companyIds);

    const activation = identityCreated ? await this.issueActivationCode(db, user.id) : undefined;
    return {
      userId: user.id,
      email,
      membershipId: membership.id,
      identityCreated,
      reactivated: Boolean(existing),
      activation,
    };
  }

  /** Removes a person from a tenant. The identity and the history stay (B10). */
  async removeMember(db: DbClient, input: { tenantId: string; email: string }) {
    const user = await this.repository.findUserByEmail(db, normalizeEmail(input.email));
    const membership = user && (await this.repository.findMembership(db, input.tenantId, user.id));
    if (!membership || membership.status !== 'ACTIVE') {
      throw new DomainException('MEMBERSHIP_NOT_FOUND', HttpStatus.NOT_FOUND, {
        detail: input.email,
      });
    }
    await this.repository.updateMembership(db, input.tenantId, membership.id, {
      status: 'REMOVED',
    });
  }

  /** A new one-time code for the user; any unused previous code stops working. */
  async issueActivationCode(db: DbClient, userId: string) {
    const { code, hash, expiresAt } = newActivationCode();
    await this.repository.replaceActivationToken(db, { userId, tokenHash: hash, expiresAt });
    return { code, expiresAt };
  }

  /** Same as issueActivationCode, for a person named by email (terminal commands). */
  async issueActivationCodeFor(db: DbClient, email: string) {
    const user = await this.repository.findUserByEmail(db, normalizeEmail(email));
    if (!user) throw new DomainException('USER_NOT_FOUND', HttpStatus.NOT_FOUND, { detail: email });
    return { email: user.email, ...(await this.issueActivationCode(db, user.id)) };
  }

  async listMembers(db: DbClient, tenantId: string) {
    const members = await this.repository.listMembers(db, tenantId);
    return members.map((m) => ({
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      status: m.status,
      access: {
        status: m.status,
        allCompanies: m.allCompanies,
        companyIds: m.companies.map((c) => c.companyId),
      } satisfies CompanyAccess,
    }));
  }
}

function parseRole(value: string): MembershipRole {
  const role = value.trim().toUpperCase().replace(/-/g, '_');
  if (!(ROLES as string[]).includes(role)) {
    throw new DomainException('INVALID_ROLE', HttpStatus.BAD_REQUEST, {
      detail: `expected one of ${ROLES.join(', ')}`,
    });
  }
  return role as MembershipRole;
}
