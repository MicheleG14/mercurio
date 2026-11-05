import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { businessToday } from './dates.js';

/** `?year=2026` of the statistics of the overview; without it, the current year. */
export class YearQuery {
  @ApiPropertyOptional({ minimum: 2000, maximum: 2100, description: 'Default: the current year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

/** The first and the last day of a calendar year, as `YYYY-MM-DD`. */
export function yearBounds(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** The year asked for, or the current one in business time (Europe/Rome). */
export function yearOrCurrent(year: number | undefined, today = businessToday()): number {
  return year ?? Number(today.slice(0, 4));
}

/**
 * Twelve entries, January to December: the row of each month where there is one, `empty(month)`
 * otherwise. Charts always draw twelve bars, a month without documents included.
 */
export function twelveMonths<T extends { month: number }>(
  rows: readonly T[],
  empty: (month: number) => T,
): T[] {
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  return Array.from({ length: 12 }, (_, i) => byMonth.get(i + 1) ?? empty(i + 1));
}
