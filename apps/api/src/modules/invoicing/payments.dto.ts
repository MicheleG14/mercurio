import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { InvoiceKind, PaymentKind } from '../../generated/prisma/client.js';
import { PageQuery } from '../../shared/pagination.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAYMENT_KINDS = Object.values(PaymentKind);
const DUE_STATUSES = ['open', 'overdue', 'paid'] as const;

// ---- Input ---------------------------------------------------------------------------------

export class AllocationInputDto {
  @ApiProperty() @IsUUID() dueDateId!: string;
  @ApiProperty({ example: '61.00', description: 'Decimal string (B30), positive' })
  @IsString()
  @MaxLength(20)
  amount!: string;
}

export class CreatePaymentDto {
  @ApiProperty({
    description: 'Chosen by the client (UUID v7): sending it again is not a new payment',
  })
  @Matches(UUID_V7)
  id!: string;

  @ApiPropertyOptional({
    enum: PAYMENT_KINDS,
    enumName: 'PaymentKind',
    description: 'RECEIPT from the customer (default), or REFUND of a credit note',
  })
  @IsOptional()
  @IsIn(PAYMENT_KINDS)
  kind?: PaymentKind;

  @ApiProperty() @IsUUID() partyId!: string;

  @ApiPropertyOptional({ example: '2026-11-05', description: 'Default today (Italian time)' })
  @IsOptional()
  @Matches(DATE)
  paymentDate?: string;

  @ApiProperty({ example: '122.00' }) @IsString() @MaxLength(20) amount!: string;

  @ApiProperty({ example: 'MP05' }) @IsString() @MaxLength(4) method!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 60,
    description: 'CRO, TRN, cheque',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @ApiProperty({ type: [AllocationInputDto], description: 'How the amount settles due dates' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AllocationInputDto)
  allocations!: AllocationInputDto[];
}

export class DueDatesQuery extends PageQuery {
  @ApiPropertyOptional({ enum: DUE_STATUSES })
  @IsOptional()
  @IsIn(DUE_STATUSES)
  status?: (typeof DUE_STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() partyId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) to?: string;
}

export class PaymentsQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() partyId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) to?: string;
}

// ---- Output --------------------------------------------------------------------------------

export class ScheduleRowDto {
  @ApiProperty() dueDateId!: string;
  @ApiProperty() invoiceId!: string;
  @ApiProperty({ enum: Object.values(InvoiceKind), enumName: 'InvoiceKind' }) kind!: InvoiceKind;
  @ApiProperty({ example: 'FT 12/2026' }) reference!: string;
  @ApiProperty() issueDate!: string;
  @ApiProperty() partyId!: string;
  @ApiProperty() partyName!: string;
  @ApiProperty() seq!: number;
  @ApiProperty() dueDate!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() settledAmount!: string;
  @ApiProperty() openAmount!: string;
  @ApiProperty() overdue!: boolean;
}

export class SchedulePageDto {
  @ApiProperty({ type: [ScheduleRowDto] }) items!: ScheduleRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ description: 'Open amount of the whole selection; credit notes count less' })
  openTotal!: string;
  @ApiProperty({ description: 'Of which overdue' }) overdueTotal!: string;
}

export class AllocationDto {
  @ApiProperty() dueDateId!: string;
  @ApiProperty() invoiceId!: string;
  @ApiProperty({ example: 'FT 12/2026' }) reference!: string;
  @ApiProperty() dueDate!: string;
  @ApiProperty() amount!: string;
}

export class PaymentDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PAYMENT_KINDS, enumName: 'PaymentKind' }) kind!: PaymentKind;
  @ApiProperty() partyId!: string;
  @ApiProperty() partyName!: string;
  @ApiProperty() paymentDate!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() method!: string;
  @ApiProperty({ type: String, nullable: true }) reference!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'The payment this one undoes' })
  reversesId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'The payment that undid this one' })
  reversedById!: string | null;
  @ApiProperty({ type: [AllocationDto] }) allocations!: AllocationDto[];
  @ApiProperty() createdAt!: string;
}

export class PaymentPageDto {
  @ApiProperty({ type: [PaymentDto] }) items!: PaymentDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class InvoicingSummaryDto {
  @ApiProperty() toInvoice!: number;
  @ApiProperty() drafts!: number;
  @ApiProperty({ example: '0.00' }) overdue!: string;
  @ApiProperty({ example: '0.00', description: 'Open, due in the next 30 days' }) dueSoon!: string;
  @ApiProperty({ example: '0.00', description: 'Taxable invoiced this month, less credit notes' })
  invoicedThisMonth!: string;
}
