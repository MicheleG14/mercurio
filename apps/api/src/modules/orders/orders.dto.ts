import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
import { OrderKind, OrderStatus } from '../../generated/prisma/client.js';
import { PageQuery, queryBoolean } from '../../shared/pagination.js';

/** UUID version 7 (B7), chosen by the client for what must not be created twice (B33). */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_LINES = 200;
const KINDS = Object.values(OrderKind);
const STATUSES = [...Object.values(OrderStatus), 'OPEN'] as const;

export class OrderLineInputDto {
  @ApiProperty() @IsUUID() itemId!: string;

  @ApiPropertyOptional({
    maxLength: 500,
    description: "What the order prints; the item's description when absent",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: '5', description: 'Positive decimal string (B30)' })
  @IsString()
  @MaxLength(20)
  quantity!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '12.5',
    description: 'Unit price (4 decimals); required to confirm a sales order',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unitPrice?: string | null;

  @ApiPropertyOptional({ example: '10', description: 'Discount in percent, 0 to 100' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  discountPercent?: string;

  @ApiPropertyOptional({ example: '22', description: "VAT code; the item's when absent" })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  vatCode?: string;
}

/** Header and lines of a draft: what creating and saving it send. */
export class OrderContentDto {
  @ApiPropertyOptional({ example: '2026-10-28', description: 'Default today (Italian time)' })
  @IsOptional()
  @Matches(DATE)
  orderDate?: string;

  @ApiProperty({ description: 'Supplier of a purchase order, customer of a sales order' })
  @IsUUID()
  partyId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Required to confirm' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 35,
    description: "The customer's order number, or the supplier's confirmation",
  })
  @IsOptional()
  @IsString()
  @MaxLength(35)
  partyReference?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-10-27' })
  @IsOptional()
  @Matches(DATE)
  partyReferenceDate?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-11-15' })
  @IsOptional()
  @Matches(DATE)
  requestedDate?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiProperty({ type: [OrderLineInputDto], maxItems: MAX_LINES })
  @IsArray()
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines!: OrderLineInputDto[];
}

export class CreateOrderDto extends OrderContentDto {
  @ApiProperty({
    description: 'Chosen by the client (UUID v7): sending it again is not a new order',
  })
  @Matches(UUID_V7)
  id!: string;

  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind!: OrderKind;
}

export class UpdateOrderDto extends OrderContentDto {
  @ApiProperty({ description: 'The version read (B29)' }) @IsInt() @Min(1) version!: number;
}

export class VersionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

export class VersionQuery {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class CloseOrderDto extends VersionDto {
  @ApiPropertyOptional({ type: [String], description: 'The lines to close; all when absent' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  lineIds?: string[];
}

export class DuplicateOrderDto {
  @ApiProperty({ description: 'Id of the new draft (UUID v7, B33)' }) @Matches(UUID_V7) id!: string;
}

export class FulfilmentLineInputDto {
  @ApiProperty() @IsUUID() orderLineId!: string;

  @ApiProperty({ example: '3', description: 'Zero or more (B30): zero leaves the line out' })
  @IsString()
  @MaxLength(20)
  quantity!: string;
}

export class CreateFulfilmentDto {
  @ApiProperty({
    description: 'Chosen by the client (UUID v7); also the id of the stock document it records',
  })
  @Matches(UUID_V7)
  id!: string;

  @ApiPropertyOptional({ example: '2026-10-28', description: 'Default today (Italian time)' })
  @IsOptional()
  @Matches(DATE)
  documentDate?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 35 })
  @IsOptional()
  @IsString()
  @MaxLength(35)
  partyDocumentRef?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-10-27' })
  @IsOptional()
  @Matches(DATE)
  partyDocumentDate?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiProperty({ type: [FulfilmentLineInputDto], minItems: 1, maxItems: MAX_LINES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => FulfilmentLineInputDto)
  lines!: FulfilmentLineInputDto[];
}

/** `q` finds a number (OC-2026/12), the party's reference or the party's name; `sort` takes
 * date, number, requestedDate, party or total. */
export class OrdersQuery extends PageQuery {
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind!: OrderKind;

  @ApiPropertyOptional({ enum: STATUSES, description: 'OPEN: confirmed or partial' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @ApiPropertyOptional() @IsOptional() @IsUUID() partyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DATE) to?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Open sales orders with lines not covered by a reservation',
  })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  uncovered: boolean = false;

  @ApiPropertyOptional({ default: false, description: 'Open orders past their requested date' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  late: boolean = false;
}

export class OrderItemSearchQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;

  @ApiPropertyOptional({ description: 'Show the available stock in this warehouse' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class OrderPartySearchQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind!: OrderKind;
}

export class IncomingQuery {
  @ApiProperty() @IsUUID() itemId!: string;
}

export class ReorderProposalQuery {
  @ApiProperty() @IsUUID() warehouseId!: string;
}

// --- Responses ---

export class OrderLineDto {
  @ApiProperty() id!: string;
  @ApiProperty() lineNo!: number;
  @ApiProperty() itemId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() description!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() unitDecimals!: number;
  @ApiProperty({ example: '10.000' }) quantity!: string;
  @ApiProperty({ type: String, nullable: true }) unitPrice!: string | null;
  @ApiProperty() discountPercent!: string;
  @ApiProperty() vatCode!: string;
  @ApiProperty() vatRate!: string;
  @ApiProperty({ type: String, nullable: true }) vatNature!: string | null;
  @ApiProperty({ type: String, nullable: true }) lineAmount!: string | null;
  @ApiProperty({ description: 'Received or shipped' }) doneQuantity!: string;
  @ApiProperty({ description: 'Closed by hand: will not move' }) closedQuantity!: string;
  @ApiProperty({ description: 'Still to receive or ship' }) remainingQuantity!: string;
  @ApiProperty({ description: 'Held for this line in the warehouse (sales)' })
  reservedQuantity!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Free stock of the item in the order’s warehouse',
  })
  availableQuantity!: string | null;
}

export class VatRowDto {
  @ApiProperty() vatCode!: string;
  @ApiProperty() rate!: string;
  @ApiProperty({ type: String, nullable: true }) nature!: string | null;
  @ApiProperty() taxable!: string;
  @ApiProperty() vat!: string;
}

export class FulfilmentLineDto {
  @ApiProperty() orderLineId!: string;
  @ApiProperty() quantity!: string;
}

export class FulfilmentDto {
  @ApiProperty() id!: string;
  @ApiProperty() documentDate!: string;
  @ApiProperty() stockDocumentId!: string;
  @ApiProperty({ example: 'CA-2026/0042' }) stockDocumentReference!: string;
  @ApiProperty({ type: String, nullable: true }) reversalDocumentId!: string | null;
  @ApiProperty({ type: String, nullable: true }) reversalDocumentReference!: string | null;
  @ApiProperty({ type: String, nullable: true }) reversedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) createdByName!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: [FulfilmentLineDto] }) lines!: FulfilmentLineDto[];
}

export class OrderSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: KINDS }) kind!: OrderKind;
  @ApiProperty({ enum: Object.values(OrderStatus) }) status!: OrderStatus;
  @ApiProperty({ type: String, nullable: true, example: 'OC-2026/0012' })
  reference!: string | null;
  @ApiProperty() orderDate!: string;
  @ApiProperty() partyId!: string;
  @ApiProperty() partyName!: string;
  @ApiProperty({ type: String, nullable: true }) warehouseId!: string | null;
  @ApiProperty({ type: String, nullable: true }) warehouseCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) partyReference!: string | null;
  @ApiProperty({ type: String, nullable: true }) requestedDate!: string | null;
  @ApiProperty() taxableTotal!: string;
  @ApiProperty() total!: string;
  @ApiProperty() lineCount!: number;
  @ApiProperty({ description: 'Open and past its requested date' }) late!: boolean;
  @ApiProperty({ description: 'Open sales order with lines not covered by a reservation' })
  uncovered!: boolean;
  @ApiProperty() version!: number;
}

export class OrderDto extends OrderSummaryDto {
  @ApiProperty({ type: String, nullable: true }) warehouseName!: string | null;
  @ApiProperty({ type: String, nullable: true }) partyReferenceDate!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty() vatTotal!: string;
  @ApiProperty({ type: [VatRowDto] }) vatSummary!: VatRowDto[];
  @ApiProperty({ type: [OrderLineDto] }) lines!: OrderLineDto[];
  @ApiProperty({ type: [FulfilmentDto] }) fulfilments!: FulfilmentDto[];
  @ApiProperty({ type: String, nullable: true }) createdByName!: string | null;
  @ApiProperty({ type: String, nullable: true }) confirmedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelledAt!: string | null;
  @ApiProperty() createdAt!: string;
}

export class OrderPageDto {
  @ApiProperty({ type: [OrderSummaryDto] }) items!: OrderSummaryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class OrderItemOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() description!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() unitDecimals!: number;
  @ApiProperty({ type: String, nullable: true, description: 'List price' })
  salePrice!: string | null;
  @ApiProperty() vatCode!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Free stock in the warehouse asked for',
  })
  availableQuantity!: string | null;
}

export class OrderPartyOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) vatNumber!: string | null;
}

export class IncomingOrderDto {
  @ApiProperty() orderId!: string;
  @ApiProperty() reference!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() warehouseCode!: string;
  @ApiProperty({ type: String, nullable: true }) requestedDate!: string | null;
  @ApiProperty() remainingQuantity!: string;
}

export class IncomingDto {
  @ApiProperty() itemId!: string;
  @ApiProperty({ description: 'Ordered from suppliers and not received yet' })
  quantity!: string;
  @ApiProperty({ type: [IncomingOrderDto] }) orders!: IncomingOrderDto[];
}

export class ReorderProposalLineDto {
  @ApiProperty() itemId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() description!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() unitDecimals!: number;
  @ApiProperty() vatCode!: string;
  @ApiProperty() availableQuantity!: string;
  @ApiProperty() reorderPoint!: string;
  @ApiProperty({ description: 'Already ordered from suppliers for this warehouse' })
  incomingQuantity!: string;
  @ApiProperty({ description: 'What to order: the reorder quantity, less what is incoming' })
  proposedQuantity!: string;
}

export class OrdersSummaryDto {
  @ApiProperty({ description: 'Open sales orders' }) salesOpen!: number;
  @ApiProperty({ description: 'Open sales orders with lines not reserved' })
  salesUncovered!: number;
  @ApiProperty() salesLate!: number;
  @ApiProperty({ description: 'Open purchase orders' }) purchaseOpen!: number;
  @ApiProperty() purchaseLate!: number;
}
