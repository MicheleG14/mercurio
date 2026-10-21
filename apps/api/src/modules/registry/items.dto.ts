import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { IsDecimalString, PRICE } from '../../shared/decimal.js';
import { PageQuery, queryBoolean } from '../../shared/pagination.js';
import { Text } from './dto-fields.js';

export class ItemsQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Goods (true) or services (false)' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  stockManaged?: boolean;

  @ApiPropertyOptional({ description: 'Archived items instead of active ones', default: false })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  archived: boolean = false;
}

export class CreateItemDto {
  @ApiProperty({ example: 'VT-M6-20', description: '1-35 letters, digits and - . _ /' })
  @IsString()
  @MaxLength(100)
  code!: string;

  @ApiProperty({ example: 'Vite a testa esagonale M6x20', maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  description!: string;

  @ApiProperty({ example: 'PZ', description: 'A unit of measure from the reference data' })
  @IsString()
  @MaxLength(10)
  unit!: string;

  @ApiProperty({ example: '22', description: 'A VAT code from the reference data' })
  @IsString()
  @MaxLength(10)
  vatCode!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '12.5',
    description: 'Decimal string with a dot, up to 4 decimals (B30)',
  })
  @IsOptional()
  @IsDecimalString(PRICE)
  salePrice?: string | null;

  @ApiPropertyOptional({ default: true, description: 'True for goods, false for services' })
  @IsOptional()
  @IsBoolean()
  stockManaged?: boolean;

  @Text(2000) notes?: string | null;
}

/** Only the fields sent change. The code is not among them: it never changes. */
export class UpdateItemDto extends PartialType(OmitType(CreateItemDto, ['code'] as const)) {
  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class ItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() description!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() vatCode!: string;
  @ApiProperty({ type: String, nullable: true, example: '12.5000' }) salePrice!: string | null;
  @ApiProperty() stockManaged!: boolean;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) archivedAt!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class ItemPageDto {
  @ApiProperty({ type: [ItemDto] }) items!: ItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
