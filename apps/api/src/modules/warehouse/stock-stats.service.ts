import { Injectable } from '@nestjs/common';
import { companyOf, TenantContextService, TenantDatabase } from '../../prisma/index.js';
import { businessToday } from '../../shared/dates.js';
import { twelveMonths, yearBounds, yearOrCurrent } from '../../shared/periods.js';
import { type DocumentType, STOCK_REASONS } from './reasons.js';
import type { StockMonthDto, StockStatsDto } from './stock-stats.dto.js';
import { StockStatsRepository } from './stock-stats.repository.js';

/**
 * The warehouse part of the overview: how many documents of each type a month (docs/adr/0032).
 * A reversed document and its reversal cancel out, so neither counts.
 */
@Injectable()
export class StockStatsService {
  constructor(
    private readonly repository: StockStatsRepository,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  stats(year: number | undefined, today = businessToday()): Promise<StockStatsDto> {
    const { companyId } = companyOf(this.contexts.require());
    const chosen = yearOrCurrent(year, today);
    const { from, to } = yearBounds(chosen);
    return this.db.run(async (tx) => {
      const rows = await this.repository.documentsByMonth(tx, companyId, from, to);
      const counted = new Map<number, Record<DocumentType, number>>();
      for (const row of rows) {
        if (row.reason === 'REVERSAL') continue;
        const month = counted.get(row.month) ?? {
          receipt: 0,
          issue: 0,
          adjustment: 0,
          transfer: 0,
        };
        month[STOCK_REASONS[row.reason].type] += Number(row.count);
        counted.set(row.month, month);
      }
      const month = (m: number): StockMonthDto => ({
        month: m,
        ...(counted.get(m) ?? { receipt: 0, issue: 0, adjustment: 0, transfer: 0 }),
      });
      return {
        year: chosen,
        years: await this.repository.years(tx, companyId),
        months: twelveMonths<StockMonthDto>([], month),
      };
    });
  }
}
