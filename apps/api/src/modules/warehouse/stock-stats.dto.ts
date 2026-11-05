import { ApiProperty } from '@nestjs/swagger';

export class StockMonthDto {
  @ApiProperty({ minimum: 1, maximum: 12 }) month!: number;
  @ApiProperty({ description: 'Receipts: opening, from suppliers, returns from customers' })
  receipt!: number;
  @ApiProperty({ description: 'Issues: sales, internal use, losses' }) issue!: number;
  @ApiProperty({ description: 'Inventory counts' }) adjustment!: number;
  @ApiProperty({ description: 'Transfers between warehouses' }) transfer!: number;
}

export class StockStatsDto {
  @ApiProperty() year!: number;
  @ApiProperty({ type: [Number], description: 'Years with stock documents, newest first' })
  years!: number[];
  @ApiProperty({
    type: [StockMonthDto],
    description: 'Documents per month and type, reversed ones and reversals left out',
  })
  months!: StockMonthDto[];
}
