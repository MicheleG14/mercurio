import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ModuleEnabledGuard } from './requires-module.js';
import { TenancyRepository } from './tenancy.repository.js';
import { TenancyService } from './tenancy.service.js';

/** Tenants, companies and enabled modules. Other modules use only what index.ts exports. */
@Module({
  providers: [
    TenancyRepository,
    TenancyService,
    { provide: APP_GUARD, useClass: ModuleEnabledGuard },
  ],
  exports: [TenancyService],
})
export class TenancyModule {}
