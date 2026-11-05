import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { companyOf, TenantContextService, TenantDatabase } from '../../prisma/index.js';
import { businessToday } from '../../shared/dates.js';
import { AMOUNT } from '../../shared/money.js';
import { twelveMonths, yearBounds, yearOrCurrent } from '../../shared/periods.js';
import type { OrdersMonthDto, OrdersStatsDto } from './orders-stats.dto.js';
import { OrdersStatsRepository } from './orders-stats.repository.js';

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal | null | undefined) => (value ?? ZERO).toFixed(AMOUNT.scale);

/** The orders part of the overview: sales ordered and shipped in a year, and what is left. */
@Injectable()
export class OrdersStatsService {
  constructor(
    private readonly repository: OrdersStatsRepository,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  stats(year: number | undefined, today = businessToday()): Promise<OrdersStatsDto> {
    const { companyId } = companyOf(this.contexts.require());
    const chosen = yearOrCurrent(year, today);
    const { from, to } = yearBounds(chosen);
    return this.db.run(async (tx) => {
      const ordered = new Map(
        (await this.repository.orderedByMonth(tx, companyId, from, to)).map((r) => [
          r.month,
          r.amount,
        ]),
      );
      const shipped = new Map(
        (await this.repository.shippedByMonth(tx, companyId, from, to)).map((r) => [
          r.month,
          r.amount,
        ]),
      );
      const month = (m: number): OrdersMonthDto => ({
        month: m,
        ordered: money(ordered.get(m)),
        shipped: money(shipped.get(m)),
      });
      const backlog = await this.repository.backlogByCustomer(tx, companyId);
      return {
        year: chosen,
        years: await this.repository.years(tx, companyId),
        months: twelveMonths<OrdersMonthDto>([], month),
        backlog: money(backlog.reduce((sum, row) => sum.add(row.amount ?? ZERO), ZERO)),
        backlogCustomers: backlog.slice(0, 5).map((row) => ({
          partyId: row.partyId,
          name: row.name,
          amount: money(row.amount),
        })),
      };
    });
  }
}
