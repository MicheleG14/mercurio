import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CompanyContext, TenantTransaction } from '../../prisma/index.js';
import { type AuditEventType, AuditService } from '../audit/index.js';

type InvoicingEvent = AuditEventType &
  (`INVOICE_${string}` | 'CREDIT_NOTE_ISSUED' | `PAYMENT_${string}`);

/** The audit events of invoicing: one per action, about the document or the payment. */
@Injectable()
export class InvoicingEvents {
  constructor(private readonly audit: AuditService) {}

  record(
    tx: TenantTransaction,
    company: CompanyContext,
    type: InvoicingEvent,
    subject: { type: 'invoice' | 'invoice_draft' | 'payment'; id: string },
    details: Prisma.InputJsonObject,
  ) {
    return this.audit.recordTenantEvent(tx, {
      tenantId: company.tenantId,
      actorUserId: company.userId,
      source: company.userId ? 'API' : 'CLI',
      type,
      subject,
      details,
    });
  }
}
