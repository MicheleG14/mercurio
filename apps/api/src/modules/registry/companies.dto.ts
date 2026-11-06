import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Text } from './dto-fields.js';

// The company's invoice header data (phase 5). Its name and identifiers are set when it is
// created (by an administrator from phase 7, or from the terminal) and never change after.

/** UUID version 7 (B7), chosen by the client so a second click adds no second company (B33). */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A further company of the group: its identity only, the header data follow in its own page. */
export class CreateCompanyDto {
  @ApiProperty({ description: 'Id of the new company (UUID v7, B33)' })
  @Matches(UUID_V7)
  id!: string;

  @ApiProperty({ example: 'Rossi Logistica Srl' })
  @IsString()
  @MaxLength(200)
  legalName!: string;

  @ApiProperty({ example: '12345678903' })
  @IsString()
  @MaxLength(30)
  vatNumber!: string;

  @ApiPropertyOptional({ example: '12345678903' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  taxCode?: string;

  @ApiPropertyOptional({ example: 'IT', description: 'ISO 3166-1 alpha-2', default: 'IT' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;
}

/** Only the fields sent change; null empties an optional field. */
export class UpdateCompanyDto {
  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @Text(200, 'Via Roma 1') address?: string | null;
  @Text(20, '20121') postalCode?: string | null;
  @Text(100, 'Milano') city?: string | null;
  @Text(2, 'MI') province?: string | null;
  /** Register of companies (REA): province of the office and number. */
  @Text(2, 'MI') reaOffice?: string | null;
  @Text(20, '1234567') reaNumber?: string | null;
  /** Decimal string (B30), in euro. */
  @Text(20, '10000.00') shareCapital?: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  @IsOptional()
  @IsBoolean()
  soleShareholder?: boolean | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() inLiquidation?: boolean;

  @ApiPropertyOptional({ example: 'RF01' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  taxRegime?: string;

  @Text(40, 'IT60X0542811101000000123456') iban?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 320 })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 320 })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  pecEmail?: string | null;

  @Text(40) phone?: string | null;

  @ApiPropertyOptional({ description: 'Charge the stamp duty of exempt invoices to the customer' })
  @IsOptional()
  @IsBoolean()
  chargeStampDuty?: boolean;
}

export class CompanyDto {
  @ApiProperty() id!: string;
  @ApiProperty() legalName!: string;
  @ApiProperty() vatNumber!: string;
  @ApiProperty({ type: String, nullable: true }) taxCode!: string | null;
  @ApiProperty({ example: 'IT' }) country!: string;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty({ type: String, nullable: true }) postalCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) city!: string | null;
  @ApiProperty({ type: String, nullable: true }) province!: string | null;
  @ApiProperty({ type: String, nullable: true }) reaOffice!: string | null;
  @ApiProperty({ type: String, nullable: true }) reaNumber!: string | null;
  @ApiProperty({ type: String, nullable: true }) shareCapital!: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) soleShareholder!: boolean | null;
  @ApiProperty() inLiquidation!: boolean;
  @ApiProperty({ example: 'RF01' }) taxRegime!: string;
  @ApiProperty({ type: String, nullable: true }) iban!: string | null;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) pecEmail!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty() chargeStampDuty!: boolean;
  @ApiProperty({
    type: [String],
    example: ['address'],
    description: 'Fields an invoice needs and the company lacks; empty when it can issue',
  })
  missingForInvoices!: string[];
  @ApiProperty() version!: number;
}

export class CompanyListDto {
  @ApiProperty({ type: [CompanyDto] }) items!: CompanyDto[];
}
