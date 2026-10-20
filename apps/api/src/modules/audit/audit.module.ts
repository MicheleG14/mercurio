import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';

/** The record of who did what: security events of people and events inside tenants. */
@Module({
  controllers: [AuditController],
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
