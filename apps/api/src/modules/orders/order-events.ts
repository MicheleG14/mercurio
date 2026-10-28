import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CompanyContext, TenantTransaction } from '../../prisma/index.js';
import { type AuditEventType, AuditService } from '../audit/index.js';

/** The audit events of orders: one per action, about the order, with its reference. */
@Injectable()
export class OrderEvents {
  constructor(private readonly audit: AuditService) {}

  record(
    tx: TenantTransaction,
    company: CompanyContext,
    type: AuditEventType & `ORDER_${string}`,
    orderId: string,
    details: Prisma.InputJsonObject,
  ) {
    return this.audit.recordTenantEvent(tx, {
      tenantId: company.tenantId,
      actorUserId: company.userId,
      source: company.userId ? 'API' : 'CLI',
      type,
      subject: { type: 'order', id: orderId },
      details,
    });
  }
}
