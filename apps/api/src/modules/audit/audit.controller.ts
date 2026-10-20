import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../identity/index.js';
import { AuditEventPageDto, AuditEventsQuery } from './audit.dto.js';
import { AuditService } from './audit.service.js';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequiresPermission('audit:read')
  @ApiOkResponse({ type: AuditEventPageDto, description: 'Events of the current tenant' })
  list(@Query() query: AuditEventsQuery): Promise<AuditEventPageDto> {
    return this.audit.listTenantEvents(query);
  }
}
