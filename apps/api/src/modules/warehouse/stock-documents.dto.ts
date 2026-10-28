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
import { PageQuery } from '../../shared/pagination.js';
import {
  DOCUMENT_TYPES,
  type DocumentType,
  POSTABLE_REASONS,
  type PostableReason,
} from './reasons.js';

/** UUID version 7 (B7): ordered by time, like every id the database makes. */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_LINES = 200;
const REASONS = [...POSTABLE_REASONS, 'REVERSAL'] as const;

export class StockLineInputDto {
  @ApiProperty() @IsUUID() itemId!: string;

  @ApiPropertyOptional({
    example: '5',
    description: 'Positive decimal string (B30); the reason gives the sign. Not for adjustments',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  quantity?: string;

  @ApiPropertyOptional({
    example: '12.5',
    description: 'Inventory adjustments only: what was counted (zero or more)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  countedQuantity?: string;
}

export class CreateStockDocumentDto {
  @ApiProperty({
    description:
      'Chosen by the client (UUID v7) when it opens the form: sending it again does not record a second document (B33)',
  })
  @Matches(UUID_V7)
  id!: string;

  @ApiProperty({ enum: POSTABLE_REASONS })
  @IsIn(POSTABLE_REASONS)
  reason!: PostableReason;

  @ApiPropertyOptional({ example: '2026-10-23', description: 'Default today (Italian time)' })
  @IsOptional()
  @Matches(DATE)
  documentDate?: string;

  @ApiProperty() @IsUUID() warehouseId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Transfers only' })
  @IsOptional()
  @IsUUID()
  targetWarehouseId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Supplier or customer' })
  @IsOptional()
  @IsUUID()
  partyId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 35,
    description: "Number of the supplier's delivery note (DDT)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(35)
  partyDocumentRef?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-10-22' })
  @IsOptional()
  @Matches(DATE)
  partyDocumentDate?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiProperty({ type: [StockLineInputDto], minItems: 1, maxItems: MAX_LINES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => StockLineInputDto)
  lines!: StockLineInputDto[];
}

export class StockDocumentsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: REASONS })
  @IsOptional()
  @IsIn(REASONS)
  reason?: PostableReason | 'REVERSAL';

  @ApiPropertyOptional({ enum: DOCUMENT_TYPES, description: 'Reversals included' })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  type?: DocumentType;

  @ApiPropertyOptional({ description: 'Documents moving goods in or out of this warehouse' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() partyId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DATE) to?: string;
}

export class DocumentLinkDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'CA-2026/0042' }) reference!: string;
}

/** The document of another module that made this one (an order): only it can undo it. */
export class OriginDto {
  @ApiProperty({ example: 'order' }) type!: string;
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'OF-2026/0007' }) reference!: string;
}

export class StockLineDto {
  @ApiProperty() lineNo!: number;
  @ApiProperty() itemId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() itemDescription!: string;
  @ApiProperty() unit!: string;
  @ApiProperty({
    example: '5.000',
    description:
      'Amount moved, positive; for an adjustment the signed difference; for a reversal as in the document it reverses',
  })
  quantity!: string;
  @ApiProperty({ type: String, nullable: true }) countedQuantity!: string | null;
}

export class StockDocumentSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'CA-2026/0042' }) reference!: string;
  @ApiProperty({ enum: REASONS }) reason!: string;
  @ApiProperty({ enum: DOCUMENT_TYPES }) type!: DocumentType;
  @ApiProperty({ example: '2026-10-23' }) documentDate!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() warehouseCode!: string;
  @ApiProperty({ type: String, nullable: true }) targetWarehouseId!: string | null;
  @ApiProperty({ type: String, nullable: true }) targetWarehouseCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) partyId!: string | null;
  @ApiProperty({ type: String, nullable: true }) partyName!: string | null;
  @ApiProperty({ type: String, nullable: true }) partyDocumentRef!: string | null;
  @ApiProperty() lineCount!: number;
  @ApiProperty({ type: DocumentLinkDto, nullable: true }) reverses!: DocumentLinkDto | null;
  @ApiProperty({ type: DocumentLinkDto, nullable: true }) reversedBy!: DocumentLinkDto | null;
  @ApiProperty({ type: OriginDto, nullable: true }) origin!: OriginDto | null;
  @ApiProperty() createdAt!: string;
}

export class StockDocumentDto extends StockDocumentSummaryDto {
  @ApiProperty({ type: String, nullable: true }) partyDocumentDate!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Who recorded it' })
  createdByName!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: POSTABLE_REASONS,
    description: 'For a reversal: the reason of the document it reverses',
  })
  reversedReason!: string | null;
  @ApiProperty({ type: [StockLineDto] }) lines!: StockLineDto[];
}

export class StockDocumentPageDto {
  @ApiProperty({ type: [StockDocumentSummaryDto] }) items!: StockDocumentSummaryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
