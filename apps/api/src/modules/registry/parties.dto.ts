import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PartyKind } from '../../generated/prisma/client.js';
import { PageQuery, queryBoolean } from '../../shared/pagination.js';
import { Text } from './dto-fields.js';

// Shapes and generous limits only: the rules of each kind (required fields, Italian identifiers)
// live in party-rules.ts and answer with their own codes on the right field.

export class PartiesQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['customer', 'supplier'] })
  @IsOptional()
  @IsIn(['customer', 'supplier'])
  role?: 'customer' | 'supplier';

  @ApiPropertyOptional({ description: 'Archived parties instead of active ones', default: false })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  archived: boolean = false;
}

export class PartyLookupQuery {
  @ApiPropertyOptional({ example: '12345678903' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  vatNumber?: string;

  @ApiPropertyOptional({ example: 'RSSMRA80A01H501U' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxCode?: string;
}

export class CreatePartyDto {
  @ApiProperty({ enum: PartyKind, enumName: 'PartyKind' })
  @IsEnum(PartyKind)
  kind!: PartyKind;

  @ApiProperty() @IsBoolean() isCustomer!: boolean;
  @ApiProperty() @IsBoolean() isSupplier!: boolean;

  /** Companies and organizations; optional for sole traders; ignored for private people. */
  @Text(200, 'Ferramenta Bruni Srl') legalName?: string | null;
  @Text(100, 'Mario') firstName?: string | null;
  @Text(100, 'Rossi') lastName?: string | null;
  @Text(20, 'SRL') legalForm?: string | null;
  @Text(40, '12345678903') vatNumber?: string | null;
  @Text(40) taxCode?: string | null;
  /** ISO 3166-1 alpha-2; Italy when absent. */
  @Text(2, 'IT') country?: string | null;
  @Text(200) address?: string | null;
  @Text(20) postalCode?: string | null;
  @Text(100) city?: string | null;
  @Text(2, 'MI') province?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 320 })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @Text(40) phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 320 })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  pecEmail?: string | null;

  @Text(7, '0000000') sdiCode?: string | null;
  @Text(2000) notes?: string | null;
}

/** The version the change is based on (B29): an older one answers 409 EDIT_CONFLICT. */
export class VersionDto {
  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Only the fields sent change; null empties an optional field. */
export class UpdatePartyDto extends PartialType(CreatePartyDto) {
  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class PartyDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PartyKind, enumName: 'PartyKind' }) kind!: PartyKind;
  @ApiProperty() isCustomer!: boolean;
  @ApiProperty() isSupplier!: boolean;
  @ApiProperty({ description: 'Legal name, or "Last First" for people' }) name!: string;
  @ApiProperty({ type: String, nullable: true }) legalName!: string | null;
  @ApiProperty({ type: String, nullable: true }) firstName!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastName!: string | null;
  @ApiProperty({ type: String, nullable: true }) legalForm!: string | null;
  @ApiProperty({ type: String, nullable: true }) vatNumber!: string | null;
  @ApiProperty({ type: String, nullable: true }) taxCode!: string | null;
  @ApiProperty({ example: 'IT' }) country!: string;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty({ type: String, nullable: true }) postalCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) city!: string | null;
  @ApiProperty({ type: String, nullable: true }) province!: string | null;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) pecEmail!: string | null;
  @ApiProperty({ type: String, nullable: true }) sdiCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) archivedAt!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

/** A row of the list: enough to recognize the party and open it. */
export class PartySummaryDto extends OmitType(PartyDto, [
  'legalName',
  'firstName',
  'lastName',
  'legalForm',
  'address',
  'postalCode',
  'email',
  'phone',
  'pecEmail',
  'sdiCode',
  'notes',
  'updatedAt',
] as const) {}

export class PartyPageDto {
  @ApiProperty({ type: [PartySummaryDto] }) items!: PartySummaryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class PartyMatchDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) vatNumber!: string | null;
  @ApiProperty({ type: String, nullable: true }) taxCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) archivedAt!: string | null;
}

export class PartyLookupDto {
  @ApiProperty({ type: [PartyMatchDto] }) items!: PartyMatchDto[];
}
