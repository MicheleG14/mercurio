import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { InvoiceKind } from '../../generated/prisma/client.js';
import { PageQuery } from '../../shared/pagination.js';

/** UUID version 7 (B7), chosen by the client for what must not be created twice (B33). */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_LINES = 500;
const KINDS = Object.values(InvoiceKind);
export const PAYMENT_FILTERS = ['open', 'overdue', 'paid'] as const;

// ---- Input ---------------------------------------------------------------------------------

/**
 * A line of a draft. With `fulfilmentId` and `orderLineId` it invoices a shipped line (quantity,
 * item and VAT fixed by the shipment); with `itemId` an item or a service; with neither, a line
 * with a description and, if it has a quantity, a price and VAT of its own (transport costs); a
 * description alone is a line of text.
 */
export class DraftLineInputDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  itemId?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, description: "The item's when absent" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '5' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  quantity?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '12.5' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unitPrice?: string | null;

  @ApiPropertyOptional({ example: '10' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  discountPercent?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '22' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  vatCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  fulfilmentId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  orderLineId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'On a credit note: the line of the credited invoice it corrects',
  })
  @IsOptional()
  @IsUUID()
  creditedLineId?: string | null;

  @ApiPropertyOptional({ description: 'The stamp duty charged to the customer' })
  @IsOptional()
  @IsBoolean()
  stampDutyCharge?: boolean;
}

class DraftHeaderDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  partyId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, enum: ['it', 'en'] })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  language?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '30FM' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  paymentTerms?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'MP05' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  paymentMethod?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class CreateDraftDto extends DraftHeaderDto {
  @ApiProperty({ description: 'Chosen by the client (UUID v7): the issued invoice keeps it' })
  @Matches(UUID_V7)
  id!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Shipments of one customer to invoice: their lines become the lines of the draft',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  fulfilmentIds?: string[];

  @ApiPropertyOptional({ type: [DraftLineInputDto], maxItems: MAX_LINES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => DraftLineInputDto)
  lines?: DraftLineInputDto[];
}

export class UpdateDraftDto extends DraftHeaderDto {
  @ApiProperty({ description: 'The version read (B29)' }) @IsInt() @Min(1) version!: number;

  @ApiProperty({ type: [DraftLineInputDto], maxItems: MAX_LINES })
  @IsArray()
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => DraftLineInputDto)
  lines!: DraftLineInputDto[];
}

export class CreateCreditNoteDto {
  @ApiProperty({ description: 'Chosen by the client (UUID v7)' })
  @Matches(UUID_V7)
  id!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Lines of the invoice to credit, what is left of each; all when absent',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  lineIds?: string[];
}

export class IssueDto {
  @ApiProperty({ description: 'The version of the draft read (B29)' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ example: '2026-11-05', description: 'Default today (Italian time)' })
  @IsOptional()
  @Matches(DATE)
  issueDate?: string;
}

export class VersionQuery {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class InvoicesQuery extends PageQuery {
  @ApiPropertyOptional({ enum: KINDS }) @IsOptional() @IsIn(KINDS) kind?: InvoiceKind;
  @ApiPropertyOptional() @IsOptional() @IsUUID() partyId?: string;
  @ApiPropertyOptional({ example: '2026-01-01' }) @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @Matches(DATE) to?: string;
}

export class ToInvoiceQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() partyId?: string;
  @ApiPropertyOptional({ description: 'Shipped on or before this day' })
  @IsOptional()
  @Matches(DATE)
  to?: string;
}

export class SearchQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
}

// ---- Output --------------------------------------------------------------------------------

export class DocumentLineDto {
  @ApiProperty() id!: string;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ type: String, nullable: true }) itemId!: string | null;
  @ApiProperty({ type: String, nullable: true }) itemCode!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ type: String, nullable: true }) unit!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '5.000' }) quantity!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '12.5000' }) unitPrice!: string | null;
  @ApiProperty({ example: '0.00' }) discountPercent!: string;
  @ApiProperty({ type: String, nullable: true }) vatCode!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '22.00' }) vatRate!: string | null;
  @ApiProperty({ type: String, nullable: true }) vatNature!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '62.50' }) lineAmount!: string | null;
  @ApiProperty({ type: String, nullable: true }) fulfilmentId!: string | null;
  @ApiProperty({ type: String, nullable: true }) orderLineId!: string | null;
  @ApiProperty({ type: String, nullable: true }) creditedLineId!: string | null;
  @ApiProperty() stampDutyCharge!: boolean;
}

export class VatRowDto {
  @ApiProperty({ example: '22' }) vatCode!: string;
  @ApiProperty({ example: '22.00' }) rate!: string;
  @ApiProperty({ type: String, nullable: true }) nature!: string | null;
  @ApiProperty({ example: '100.00' }) taxable!: string;
  @ApiProperty({ example: '22.00' }) vat!: string;
}

export class DueDatePreviewDto {
  @ApiProperty() seq!: number;
  @ApiProperty({ example: '2026-12-31' }) dueDate!: string;
  @ApiProperty({ example: '61.00' }) amount!: string;
}

/** A shipment as invoicing knows it: its order and its delivery note. */
export class ShipmentRefDto {
  @ApiProperty() fulfilmentId!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ example: 'OC-2026/0012' }) orderReference!: string;
  @ApiProperty({ type: String, nullable: true }) partyReference!: string | null;
  @ApiProperty({ example: 'SC-2026/0031' }) documentReference!: string;
  @ApiProperty({ example: '2026-10-12' }) documentDate!: string;
}

export class DocumentRefDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: KINDS, enumName: 'InvoiceKind' }) kind!: InvoiceKind;
  @ApiProperty({ example: 'FT 12/2026' }) reference!: string;
  @ApiProperty({ example: '2026-11-05' }) issueDate!: string;
  @ApiProperty({ example: '122.00' }) total!: string;
}

export class InvoiceDraftDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: KINDS, enumName: 'InvoiceKind' }) kind!: InvoiceKind;
  @ApiProperty({ type: String, nullable: true }) partyId!: string | null;
  @ApiProperty({ type: String, nullable: true }) partyName!: string | null;
  @ApiProperty({ type: DocumentRefDto, nullable: true }) creditedInvoice!: DocumentRefDto | null;
  @ApiProperty({ type: String, nullable: true }) language!: string | null;
  @ApiProperty({ type: String, nullable: true }) paymentTerms!: string | null;
  @ApiProperty({ type: String, nullable: true }) paymentMethod!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: [DocumentLineDto] }) lines!: DocumentLineDto[];
  @ApiProperty({ type: [VatRowDto] }) vatSummary!: VatRowDto[];
  @ApiProperty() taxableTotal!: string;
  @ApiProperty() vatTotal!: string;
  @ApiProperty() total!: string;
  @ApiProperty({ description: 'Its exempt operations need the 2 € stamp duty' })
  stampDutyRequired!: boolean;
  @ApiProperty({
    type: [DueDatePreviewDto],
    description: 'The due dates if it were issued today with these terms',
  })
  dueDatesPreview!: DueDatePreviewDto[];
  @ApiProperty({ type: [ShipmentRefDto] }) shipments!: ShipmentRefDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Last day to issue it as a deferred invoice (15th of the month after)',
  })
  deferredDeadline!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class InvoiceDraftSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: KINDS, enumName: 'InvoiceKind' }) kind!: InvoiceKind;
  @ApiProperty({ type: String, nullable: true }) partyName!: string | null;
  @ApiProperty() total!: string;
  @ApiProperty() version!: number;
  @ApiProperty() updatedAt!: string;
}

export class InvoiceDraftPageDto {
  @ApiProperty({ type: [InvoiceDraftSummaryDto] }) items!: InvoiceDraftSummaryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class DueDateDto {
  @ApiProperty() id!: string;
  @ApiProperty() seq!: number;
  @ApiProperty({ example: '2026-12-31' }) dueDate!: string;
  @ApiProperty({ example: '61.00' }) amount!: string;
  @ApiProperty({ example: '0.00' }) settledAmount!: string;
  @ApiProperty({ example: '61.00' }) openAmount!: string;
}

/** What is left to credit of a line of an invoice. */
export class CreditableLineDto {
  @ApiProperty() lineId!: string;
  @ApiProperty({ type: String, nullable: true }) quantity!: string | null;
  @ApiProperty() amount!: string;
}

/**
 * Paid in full or not: `UNPAID`, `PARTIAL`, `PAID`; `CREDITED` when a credit note cancels it all.
 * A credit note is `SETTLED` when it gave back nothing beyond what was open, otherwise
 * `REFUND_DUE` until the refund is recorded, then `REFUNDED`.
 */
export const PAYMENT_STATUSES = [
  'UNPAID',
  'PARTIAL',
  'PAID',
  'CREDITED',
  'SETTLED',
  'REFUND_DUE',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export class InvoiceDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: KINDS, enumName: 'InvoiceKind' }) kind!: InvoiceKind;
  @ApiProperty({ example: 'FT 12/2026' }) reference!: string;
  @ApiProperty() series!: string;
  @ApiProperty() year!: number;
  @ApiProperty() number!: number;
  @ApiProperty({ example: '2026-11-05' }) issueDate!: string;
  @ApiProperty() partyId!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The seller as printed, copied when issued',
  })
  seller!: Record<string, unknown>;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The customer as printed, copied when issued',
  })
  customer!: Record<string, unknown>;
  @ApiProperty({ example: 'it' }) language!: string;
  @ApiProperty() paymentTerms!: string;
  @ApiProperty() paymentMethod!: string;
  @ApiProperty({ type: String, nullable: true }) iban!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: [DocumentLineDto] }) lines!: DocumentLineDto[];
  @ApiProperty({ type: [VatRowDto] }) vatSummary!: VatRowDto[];
  @ApiProperty() taxableTotal!: string;
  @ApiProperty() vatTotal!: string;
  @ApiProperty({ example: '0.00' }) stampDuty!: string;
  @ApiProperty() total!: string;
  @ApiProperty({ type: [DueDateDto] }) dueDates!: DueDateDto[];
  @ApiProperty({ example: '0.00' }) settledAmount!: string;
  @ApiProperty({ example: '122.00' }) openAmount!: string;
  @ApiProperty({ enum: PAYMENT_STATUSES }) paymentStatus!: PaymentStatus;
  @ApiProperty() overdue!: boolean;
  @ApiProperty({ type: DocumentRefDto, nullable: true }) creditedInvoice!: DocumentRefDto | null;
  @ApiProperty({ type: [DocumentRefDto] }) creditNotes!: DocumentRefDto[];
  @ApiProperty({ type: [CreditableLineDto] }) creditable!: CreditableLineDto[];
  @ApiProperty({ example: '122.00', description: 'What credit notes may still give back' })
  creditableTotal!: string;
  @ApiProperty({ type: [ShipmentRefDto] }) shipments!: ShipmentRefDto[];
  @ApiProperty() issuedAt!: string;
}

export class InvoiceSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: KINDS, enumName: 'InvoiceKind' }) kind!: InvoiceKind;
  @ApiProperty({ example: 'FT 12/2026' }) reference!: string;
  @ApiProperty() issueDate!: string;
  @ApiProperty() partyId!: string;
  @ApiProperty() partyName!: string;
  @ApiProperty() total!: string;
  @ApiProperty() openAmount!: string;
  @ApiProperty({ enum: PAYMENT_STATUSES }) paymentStatus!: PaymentStatus;
  @ApiProperty() overdue!: boolean;
  @ApiProperty({ type: String, nullable: true }) nextDueDate!: string | null;
}

export class InvoicePageDto {
  @ApiProperty({ type: [InvoiceSummaryDto] }) items!: InvoiceSummaryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ToInvoiceDto extends ShipmentRefDto {
  @ApiProperty() partyId!: string;
  @ApiProperty() partyName!: string;
  @ApiProperty({ example: '62.50', description: 'Taxable amount of its lines' })
  taxableAmount!: string;
  @ApiProperty({ type: String, nullable: true, description: 'The draft that has it' })
  draftId!: string | null;
}

export class ToInvoicePageDto {
  @ApiProperty({ type: [ToInvoiceDto] }) items!: ToInvoiceDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class CustomerOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) vatNumber!: string | null;
}

export class InvoiceItemOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() description!: string;
  @ApiProperty() unit!: string;
  @ApiProperty({ type: String, nullable: true }) salePrice!: string | null;
  @ApiProperty() vatCode!: string;
}
