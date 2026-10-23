import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PageQuery, queryBoolean } from '../../shared/pagination.js';

export class WarehousesQuery extends PageQuery {
  @ApiPropertyOptional({
    description: 'Archived warehouses instead of active ones',
    default: false,
  })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  archived: boolean = false;
}

export class CreateWarehouseDto {
  @ApiProperty({ example: 'SEDE', description: '1-10 letters, digits and -; stored uppercase' })
  @IsString()
  @MaxLength(20)
  code!: string;

  @ApiProperty({ example: 'Magazzino della sede', maxLength: 100 })
  @IsString()
  @MaxLength(200)
  name!: string;
}

export class VersionDto {
  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Only the name changes: the code is printed on documents. */
export class UpdateWarehouseDto extends VersionDto {
  @ApiProperty({ example: 'Deposito Nord', maxLength: 100 })
  @IsString()
  @MaxLength(200)
  name!: string;
}

export class WarehouseDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) archivedAt!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class WarehousePageDto {
  @ApiProperty({ type: [WarehouseDto] }) items!: WarehouseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
