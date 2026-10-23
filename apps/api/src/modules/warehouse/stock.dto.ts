import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQuery, queryBoolean } from '../../shared/pagination.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class StockQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'One warehouse; without it, the sum over the company' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Only items at or below their reorder point',
  })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  belowReorder: boolean = false;

  @ApiPropertyOptional({
    default: false,
    description: 'Also items that have moved but are at zero',
  })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  includeZero: boolean = false;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'Stock at the end of that day, from the movements (no reorder levels then)',
  })
  @IsOptional()
  @Matches(DATE)
  asOf?: string;
}

export class StockRowDto {
  @ApiProperty() itemId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() itemDescription!: string;
  @ApiProperty() unit!: string;
  @ApiProperty({ description: 'Decimals a quantity may have in this unit' }) unitDecimals!: number;
  @ApiProperty() itemArchived!: boolean;
  @ApiProperty({ example: '12.000' }) quantity!: string;
  @ApiProperty({ type: String, nullable: true }) reorderPoint!: string | null;
  @ApiProperty({ type: String, nullable: true }) reorderQuantity!: string | null;
  @ApiProperty() belowReorder!: boolean;
}

export class StockPageDto {
  @ApiProperty({ type: [StockRowDto] }) items!: StockRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ItemStockWarehouseDto {
  @ApiProperty() warehouseId!: string;
  @ApiProperty() warehouseCode!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty() warehouseArchived!: boolean;
  @ApiProperty() quantity!: string;
  @ApiProperty({ type: String, nullable: true }) reorderPoint!: string | null;
  @ApiProperty({ type: String, nullable: true }) reorderQuantity!: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Version of the reorder level (B29)' })
  reorderVersion!: number | null;
  @ApiProperty() belowReorder!: boolean;
}

export class ItemStockDto {
  @ApiProperty() itemId!: string;
  @ApiProperty() itemCode!: string;
  @ApiProperty() itemDescription!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() unitDecimals!: number;
  @ApiProperty() itemArchived!: boolean;
  @ApiProperty() stockManaged!: boolean;
  @ApiProperty({ description: 'Sum over the warehouses of the company' }) quantity!: string;
  @ApiProperty({ type: [ItemStockWarehouseDto] }) warehouses!: ItemStockWarehouseDto[];
}

export class MovementsQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) to?: string;
}

export class MovementRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() movementDate!: string;
  @ApiProperty() documentId!: string;
  @ApiProperty({ example: 'CA-2026/0042' }) reference!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() warehouseCode!: string;
  @ApiProperty({ description: 'Signed: positive in, negative out' }) quantity!: string;
  @ApiProperty({
    description: 'Stock after this movement (in the warehouse filtered on, or the company)',
  })
  balance!: string;
}

export class MovementPageDto {
  @ApiProperty({ type: [MovementRowDto] }) items!: MovementRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ItemSearchQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;

  @ApiPropertyOptional({ description: 'Show the stock in this warehouse' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class ItemOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() description!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() unitDecimals!: number;
  @ApiProperty() archived!: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Stock in the warehouse asked for' })
  quantity!: string | null;
}

export class PartySearchQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;

  @ApiProperty({ enum: ['supplier', 'customer'] })
  @IsIn(['supplier', 'customer'])
  role!: 'supplier' | 'customer';
}

export class PartyOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) vatNumber!: string | null;
}

export class SetReorderLevelDto {
  @ApiProperty({ example: '10', description: 'Decimal string (B30), zero or more' })
  @IsString()
  @MaxLength(20)
  reorderPoint!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '50' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  reorderQuantity?: string | null;

  @ApiPropertyOptional({ description: 'Absent to create the level, the version read to change it' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class RemoveReorderLevelQuery {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class ReorderLevelDto {
  @ApiProperty() warehouseId!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() reorderPoint!: string;
  @ApiProperty({ type: String, nullable: true }) reorderQuantity!: string | null;
  @ApiProperty() version!: number;
}

export class StockSummaryDto {
  @ApiProperty() belowReorder!: number;
  @ApiProperty() documentsToday!: number;
}
