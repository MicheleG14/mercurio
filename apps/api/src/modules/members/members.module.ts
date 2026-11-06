import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { IdentityModule } from '../identity/index.js';
import { TenancyModule } from '../tenancy/index.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { RolesController } from './roles.controller.js';

/**
 * The administration of people and roles from the interface. A module of its own because it needs
 * both identity and audit, and audit already depends on identity (its routes need permissions).
 */
@Module({
  imports: [IdentityModule, TenancyModule, AuditModule],
  controllers: [MembersController, RolesController],
  providers: [MembersService],
})
export class MembersModule {}
