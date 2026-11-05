import { ApiProperty } from '@nestjs/swagger';

export class OrdersMonthDto {
  @ApiProperty({ minimum: 1, maximum: 12 }) month!: number;
  @ApiProperty({
    example: '0.00',
    description: 'Taxable of the sales orders confirmed, by order date',
  })
  ordered!: string;
  @ApiProperty({ example: '0.00', description: 'Taxable of the goods shipped, by shipment date' })
  shipped!: string;
}

export class BacklogCustomerDto {
  @ApiProperty() partyId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '0.00' }) amount!: string;
}

export class OrdersStatsDto {
  @ApiProperty() year!: number;
  @ApiProperty({
    type: [Number],
    description: 'Years with sales orders or shipments, newest first',
  })
  years!: number[];
  @ApiProperty({ type: [OrdersMonthDto], description: 'January to December, empty months too' })
  months!: OrdersMonthDto[];
  @ApiProperty({
    example: '0.00',
    description: 'Taxable still to ship on the open sales orders, today',
  })
  backlog!: string;
  @ApiProperty({ type: [BacklogCustomerDto], description: 'At most five, by amount to ship' })
  backlogCustomers!: BacklogCustomerDto[];
}
