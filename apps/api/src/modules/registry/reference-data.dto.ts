import { ApiProperty } from '@nestjs/swagger';

export class VatCodeDto {
  @ApiProperty({ example: '22' }) code!: string;
  @ApiProperty({ example: '22.00', description: 'Decimal string (B30)' }) rate!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'N4',
    description: 'Exemption nature of the e-invoice, for 0% codes',
  })
  nature!: string | null;
}

export class LegalFormDto {
  @ApiProperty({ example: 'SRL' }) code!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['CAPITAL', 'PARTNERSHIP', 'COOPERATIVE', 'CONSORTIUM'],
  })
  category!: string | null;
}

export class ReferenceDataDto {
  @ApiProperty({ type: [VatCodeDto] }) vatCodes!: VatCodeDto[];
  @ApiProperty({ type: [String], example: ['PZ', 'KG'] }) units!: string[];
  @ApiProperty({ type: [LegalFormDto] }) legalForms!: LegalFormDto[];
}
