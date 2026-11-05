import { ApiProperty } from '@nestjs/swagger';

/** How late the open amounts are, measured on the due date. */
export const AGING_BUCKETS = [
  'NOT_DUE',
  'DAYS_1_30',
  'DAYS_31_60',
  'DAYS_61_90',
  'OVER_90',
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export class InvoicingMonthDto {
  @ApiProperty({ minimum: 1, maximum: 12 }) month!: number;
  @ApiProperty({ example: '0.00', description: 'Taxable of the invoices less the credit notes' })
  taxable!: string;
  @ApiProperty({ example: '0.00', description: 'VAT of the invoices less the credit notes' })
  vat!: string;
  @ApiProperty({ example: '0.00', description: 'Total of the invoices less the credit notes' })
  total!: string;
  @ApiProperty({ example: '0.00', description: 'Payments less refunds and reversals' })
  collected!: string;
}

export class TopCustomerDto {
  @ApiProperty() partyId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '0.00', description: 'Taxable invoiced in the year, net' })
  taxable!: string;
  @ApiProperty({ example: '0.00', description: 'Still to be paid today, any year' })
  open!: string;
}

export class InvoicingStatsDto {
  @ApiProperty() year!: number;
  @ApiProperty({ type: [Number], description: 'Years with invoices or payments, newest first' })
  years!: number[];
  @ApiProperty({ type: [InvoicingMonthDto], description: 'January to December, empty months too' })
  months!: InvoicingMonthDto[];
  @ApiProperty({ type: [TopCustomerDto], description: 'At most five, by taxable invoiced' })
  topCustomers!: TopCustomerDto[];
}

export class AgingBucketDto {
  @ApiProperty({ enum: AGING_BUCKETS }) bucket!: AgingBucket;
  @ApiProperty({ example: '0.00' }) amount!: string;
  @ApiProperty({ description: 'Open due dates in the bucket' }) count!: number;
}

export class AgingDto {
  @ApiProperty({ example: '2026-11-05' }) asOf!: string;
  @ApiProperty({ type: [AgingBucketDto], description: 'Every bucket, in order, empty ones too' })
  buckets!: AgingBucketDto[];
  @ApiProperty({ example: '0.00', description: 'Open amount of the invoices' }) total!: string;
}
