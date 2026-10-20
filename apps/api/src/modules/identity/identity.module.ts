import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/index.js';
import { IdentityRepository } from './identity.repository.js';
import { IdentityService } from './identity.service.js';

/** People, memberships and activation codes. Depends on tenancy through its public service. */
@Module({
  imports: [TenancyModule],
  providers: [IdentityRepository, IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
