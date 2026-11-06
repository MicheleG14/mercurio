import { HttpStatus, Injectable } from '@nestjs/common';
import type { MembershipRole, Prisma, TenantRole } from '../../generated/prisma/client.js';
import {
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { DomainException } from '../../shared/errors/index.js';
import type { Page, PageQuery } from '../../shared/pagination.js';
import { type AuditEventType, AuditService } from '../audit/index.js';
import {
  BUILTIN_ROLES,
  IdentityService,
  type MemberView,
  PERMISSION_MODULE,
  PERMISSION_REQUIRES,
  PERMISSIONS,
  permissionsFor,
  RESERVED_PERMISSIONS,
  type RoleChoice,
  toRoleRefDto,
} from '../identity/index.js';
import { TenancyService } from '../tenancy/index.js';
import type {
  AddedMemberDto,
  AddMemberDto,
  CreateRoleDto,
  CustomRoleDto,
  MemberDto,
  MemberPageDto,
  PermissionCatalogDto,
  RoleChoiceDto,
  RoleListDto,
  UpdateMemberDto,
  UpdateRoleDto,
} from './members.dto.js';

/**
 * The administration of a tenant from the interface: people and roles (docs/adr/0036, 0037).
 * The rules live in the identity module; this module adds the request context, the audit log and
 * the shape of the API, one transaction per use case.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
    private readonly identity: IdentityService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  // --- People -------------------------------------------------------------------------------

  async list(query: PageQuery): Promise<MemberPageDto> {
    const { tenantId, userId } = this.context();
    const views = await this.db.run((tx) => this.identity.listMemberViews(tx, tenantId));
    const q = query.q?.trim().toLowerCase();
    const found = q
      ? views.filter((v) => v.name.toLowerCase().includes(q) || v.email.includes(q))
      : views;
    const sorted = [...found].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const start = (query.page - 1) * query.pageSize;
    return {
      items: sorted.slice(start, start + query.pageSize).map((v) => toMemberDto(v, userId)),
      total: sorted.length,
      page: query.page,
      pageSize: query.pageSize,
    } satisfies Page<MemberDto>;
  }

  async get(id: string): Promise<MemberDto> {
    const { tenantId, userId } = this.context();
    const view = await this.db.run((tx) => this.identity.getMemberView(tx, tenantId, id));
    if (view.status !== 'ACTIVE') {
      throw new DomainException('MEMBERSHIP_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return toMemberDto(view, userId);
  }

  /**
   * Adds a person. A new identity gets an activation code, shown once to the administrator who
   * hands it over (no email is sent). An existing account signs in with its own credentials.
   */
  async add(dto: AddMemberDto): Promise<AddedMemberDto> {
    const { tenantId, userId } = this.context();
    return this.db.run(async (tx) => {
      const added = await this.identity.addMember(tx, {
        tenantId,
        email: dto.email,
        name: dto.name,
        role: roleChoice(dto.role),
        companies: dto.allCompanies ? 'all' : dto.companyIds,
      });
      const activation = added.identityCreated
        ? await this.identity.issueMemberActivationCode(tx, added.userId)
        : null;
      await this.record(tx, 'MEMBER_ADDED', added.membershipId, {
        email: added.email,
        role: added.role,
        companies: dto.allCompanies ? 'all' : dto.companyIds.length,
        identity: added.identityCreated ? 'new' : 'existing',
        reactivated: added.reactivated,
      });
      if (activation) {
        await this.record(tx, 'ACTIVATION_CODE_ISSUED', added.membershipId, {
          email: added.email,
          expiresAt: activation.expiresAt.toISOString(),
        });
      }
      const view = await this.identity.getMemberView(tx, tenantId, added.membershipId);
      return {
        member: toMemberDto(view, userId),
        activation: activation
          ? { code: activation.code, expiresAt: activation.expiresAt.toISOString() }
          : null,
        existingAccount: !added.identityCreated,
      };
    });
  }

  async update(id: string, dto: UpdateMemberDto): Promise<MemberDto> {
    const { tenantId, userId } = this.context();
    if ((dto.allCompanies === undefined) !== (dto.companyIds === undefined)) {
      throw new DomainException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
        errors: [{ field: 'companyIds', code: 'REQUIRED' }],
      });
    }
    return this.db.run(async (tx) => {
      const changed = await this.identity.updateMember(tx, tenantId, { userId }, id, {
        version: dto.version,
        role: dto.role ? roleChoice(dto.role) : undefined,
        companies:
          dto.allCompanies === undefined ? undefined : dto.allCompanies ? 'all' : dto.companyIds!,
      });
      const fields = (['role', 'companies'] as const).filter(
        (f) => JSON.stringify(changed.before[f]) !== JSON.stringify(changed.after[f]),
      );
      if (fields.length > 0) {
        await this.record(tx, 'MEMBER_UPDATED', id, {
          email: changed.email,
          fields: [...fields],
          ...(fields.includes('role')
            ? { roleBefore: changed.before.role, roleAfter: changed.after.role }
            : {}),
        });
      }
      return toMemberDto(await this.identity.getMemberView(tx, tenantId, id), userId);
    });
  }

  async remove(id: string, version: number): Promise<void> {
    const { tenantId, userId } = this.context();
    await this.db.run(async (tx) => {
      const removed = await this.identity.removeMemberById(tx, tenantId, { userId }, id, version);
      await this.record(tx, 'MEMBER_REMOVED', id, { email: removed.email });
    });
  }

  /** A new code for someone who has not activated their account yet; the old one stops working. */
  async issueCode(id: string) {
    const { tenantId } = this.context();
    return this.db.run(async (tx) => {
      const member = await this.identity.getMemberView(tx, tenantId, id);
      if (member.status !== 'ACTIVE') {
        throw new DomainException('MEMBERSHIP_NOT_FOUND', HttpStatus.NOT_FOUND);
      }
      const activation = await this.identity.issueMemberActivationCode(tx, member.userId);
      await this.record(tx, 'ACTIVATION_CODE_ISSUED', id, {
        email: member.email,
        expiresAt: activation.expiresAt.toISOString(),
      });
      return { code: activation.code, expiresAt: activation.expiresAt.toISOString() };
    });
  }

  // --- Roles --------------------------------------------------------------------------------

  async roles(): Promise<RoleListDto> {
    const { tenantId } = this.context();
    return this.db.run(async (tx) => {
      const counts = await this.identity.builtinRoleCounts(tx, tenantId);
      const custom = await this.identity.listRoles(tx, tenantId);
      return {
        builtin: BUILTIN_ROLES.map((key) => ({
          key,
          permissions: [...permissionsFor(key)],
          members: counts[key],
        })),
        custom: custom.map((r) => toRoleDto(r, r._count.memberships)),
      };
    });
  }

  async role(id: string): Promise<CustomRoleDto> {
    const { tenantId } = this.context();
    const role = await this.db.run((tx) => this.identity.getRole(tx, tenantId, id));
    return toRoleDto(role, role._count.memberships);
  }

  /** Every permission with its module, what it needs and whether the tenant has its module. */
  async catalog(): Promise<PermissionCatalogDto> {
    const { tenantId } = this.context();
    const modules = await this.db.run((tx) => this.tenancy.enabledModules(tx, tenantId));
    return {
      permissions: PERMISSIONS.map((key) => ({
        key,
        module: PERMISSION_MODULE[key],
        moduleEnabled:
          PERMISSION_MODULE[key] === null || (modules as string[]).includes(PERMISSION_MODULE[key]),
        requires: [...PERMISSION_REQUIRES[key]],
        reserved: RESERVED_PERMISSIONS.includes(key),
      })),
    };
  }

  async createRole(dto: CreateRoleDto): Promise<CustomRoleDto> {
    const { tenantId } = this.context();
    return this.db.run(async (tx) => {
      const role = await this.identity.createRole(tx, tenantId, {
        name: dto.name,
        description: dto.description,
        permissions: dto.permissions,
        basedOn: (dto.basedOn as MembershipRole | undefined) ?? null,
      });
      await this.record(
        tx,
        'ROLE_CREATED',
        role.id,
        {
          name: role.name,
          permissions: role.permissions,
          ...(role.basedOn ? { basedOn: role.basedOn } : {}),
        },
        'role',
      );
      return toRoleDto(role, 0);
    });
  }

  async updateRole(id: string, dto: UpdateRoleDto): Promise<CustomRoleDto> {
    const { tenantId } = this.context();
    return this.db.run(async (tx) => {
      const { before, after } = await this.identity.updateRole(tx, tenantId, id, dto);
      const added = after.permissions.filter((p) => !before.permissions.includes(p));
      const removed = before.permissions.filter((p) => !after.permissions.includes(p));
      const fields = [
        ...(before.name !== after.name ? ['name'] : []),
        ...(before.description !== after.description ? ['description'] : []),
        ...(added.length || removed.length ? ['permissions'] : []),
      ];
      if (fields.length > 0) {
        await this.record(
          tx,
          'ROLE_UPDATED',
          id,
          {
            name: after.name,
            fields,
            ...(added.length ? { added } : {}),
            ...(removed.length ? { removed } : {}),
          },
          'role',
        );
      }
      return toRoleDto(after, before._count.memberships);
    });
  }

  async archiveRole(id: string, version: number): Promise<CustomRoleDto> {
    const { tenantId } = this.context();
    return this.db.run(async (tx) => {
      const archived = await this.identity.archiveRole(tx, tenantId, id, version);
      await this.record(tx, 'ROLE_ARCHIVED', id, { name: archived.name }, 'role');
      return toRoleDto(archived, 0);
    });
  }

  // --- Helpers ------------------------------------------------------------------------------

  private context(): { tenantId: string; userId: string } {
    const context = this.contexts.require();
    // Every route here needs a permission, so the person is signed in with a tenant.
    return { tenantId: context.tenantId, userId: context.userId! };
  }

  private record(
    tx: TenantTransaction,
    type: AuditEventType,
    subjectId: string,
    details: Prisma.InputJsonObject,
    subjectType: 'membership' | 'role' = 'membership',
  ) {
    const { tenantId, userId } = this.context();
    return this.audit.recordTenantEvent(tx, {
      tenantId,
      actorUserId: userId,
      source: 'API',
      type,
      subject: { type: subjectType, id: subjectId },
      details,
    });
  }
}

function roleChoice(dto: RoleChoiceDto): RoleChoice {
  if ((dto.builtin === undefined) === (dto.customRoleId === undefined)) {
    throw new DomainException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
      errors: [{ field: 'role', code: 'ROLE_CHOICE_INVALID' }],
    });
  }
  return dto.builtin ? { builtin: dto.builtin } : { customRoleId: dto.customRoleId! };
}

function toMemberDto(view: MemberView, currentUserId: string): MemberDto {
  return {
    id: view.membershipId,
    email: view.email,
    name: view.name,
    role: toRoleRefDto(view.role),
    allCompanies: view.allCompanies,
    companyIds: view.companyIds,
    status: view.activated ? 'ACTIVE' : 'PENDING_ACTIVATION',
    canIssueCode: view.canIssueCode,
    isSelf: view.userId === currentUserId,
    lastSeenAt: view.lastSeenAt?.toISOString() ?? null,
    version: view.version,
    createdAt: view.createdAt.toISOString(),
  };
}

function toRoleDto(role: TenantRole, members: number): CustomRoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    basedOn: role.basedOn,
    members,
    version: role.version,
    archivedAt: role.archivedAt?.toISOString() ?? null,
    updatedAt: role.updatedAt.toISOString(),
  };
}
