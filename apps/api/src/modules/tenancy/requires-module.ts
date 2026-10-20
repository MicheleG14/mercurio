import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContextService, TenantDatabase } from '../../prisma/index.js';
import { DomainException } from '../../shared/errors/index.js';
import type { ModuleKey } from './module-catalog.js';
import { TenancyRepository } from './tenancy.repository.js';

const REQUIRED_MODULE = 'mercurio:requiredModule';

/**
 * Marks a controller or a route as part of a module: calls from tenants that have not
 * enabled it are refused with 403 MODULE_NOT_ENABLED (S7).
 *
 * @example
 * @RequiresModule('warehouse')
 * @Controller('stock-movements')
 */
export const RequiresModule = (key: ModuleKey) => SetMetadata(REQUIRED_MODULE, key);

/**
 * Global guard behind @RequiresModule. It reads the enabled modules as the API role, inside the
 * tenant context, so Row-Level Security applies to this lookup too. Routes without the
 * decorator are not affected.
 */
@Injectable()
export class ModuleEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexts: TenantContextService,
    private readonly db: TenantDatabase,
    private readonly repository: TenancyRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ModuleKey | undefined>(REQUIRED_MODULE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const tenant = this.contexts.current();
    // No tenant context means nobody signed in (from phase 1b the session sets it).
    if (!tenant) throw new DomainException('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);

    const enabled = await this.db.run((tx) => this.repository.listModules(tx, tenant.tenantId));
    if (!enabled.includes(required)) {
      throw new DomainException('MODULE_NOT_ENABLED', HttpStatus.FORBIDDEN, { detail: required });
    }
    return true;
  }
}
