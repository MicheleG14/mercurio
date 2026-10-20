import { Controller, Get, Headers, Query } from '@nestjs/common';
import { Public, RequiresCompany, AuthContextService } from '../../src/modules/auth/index.js';
import { RequiresPermission } from '../../src/modules/identity/index.js';
import { TenantContextService } from '../../src/prisma/index.js';

// Test-only routes that exercise the guards on top of the real sign-in. Never shipped.
@Controller('probe-auth')
export class AuthProbeController {
  constructor(
    private readonly auth: AuthContextService,
    private readonly tenant: TenantContextService,
  ) {}

  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('any')
  any() {
    return { userId: this.auth.require().userId };
  }

  @Get('audit')
  @RequiresPermission('audit:read')
  audit() {
    return { ok: true };
  }

  @Get('stock')
  @RequiresPermission('warehouse:write')
  stock() {
    return { ok: true };
  }

  @Get('company')
  @RequiresCompany()
  company() {
    return { companyId: this.tenant.require().companyId };
  }

  /** Echoes the tenant the request runs in, whatever the client tries to send. */
  @Get('whoami')
  whoami(@Query('tenantId') _query?: string, @Headers('x-tenant-id') _header?: string) {
    return { tenantId: this.tenant.current()?.tenantId ?? null };
  }
}
