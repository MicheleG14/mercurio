import { ApiProperty } from '@nestjs/swagger';

export class HealthChecksDto {
  @ApiProperty({ enum: ['up', 'down'] })
  database!: 'up' | 'down';

  @ApiProperty({
    enum: ['up', 'down'],
    description: 'Down when the database role could bypass Row-Level Security',
  })
  tenantIsolation!: 'up' | 'down';
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded'] })
  status!: 'ok' | 'degraded';

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;

  @ApiProperty({ example: '0.1.0' })
  version!: string;

  @ApiProperty({ description: 'Seconds since the process started', example: 42 })
  uptimeSeconds!: number;

  @ApiProperty({ example: '2026-10-19T15:00:00.000Z' })
  timestamp!: string;
}
