import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { companyOf, TenantContextService, TenantDatabase } from '../../prisma/index.js';
import { businessToday } from '../../shared/dates.js';
import { AMOUNT } from '../../shared/money.js';
import { twelveMonths, yearBounds, yearOrCurrent } from '../../shared/periods.js';
import {
  AGING_BUCKETS,
  type AgingDto,
  type InvoicingMonthDto,
  type InvoicingStatsDto,
} from './invoicing-stats.dto.js';
import { InvoicingStatsRepository } from './invoicing-stats.repository.js';

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal | null) => (value ?? ZERO).toFixed(AMOUNT.scale);

/** The invoicing part of the overview: a year month by month, and what is late today. */
@Injectable()
export class InvoicingStatsService {
  constructor(
    private readonly repository: InvoicingStatsRepository,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  stats(year: number | undefined, today = businessToday()): Promise<InvoicingStatsDto> {
    const { companyId } = companyOf(this.contexts.require());
    const chosen = yearOrCurrent(year, today);
    const { from, to } = yearBounds(chosen);
    return this.db.run(async (tx) => {
      const invoiced = await this.repository.invoicedByMonth(tx, companyId, from, to);
      const collected = await this.repository.collectedByMonth(tx, companyId, from, to);
      const collectedIn = new Map(collected.map((row) => [row.month, row.amount]));
      const months = twelveMonths<InvoicingMonthDto>(
        invoiced.map((row) => ({
          month: row.month,
          taxable: money(row.taxable),
          vat: money(row.vat),
          total: money(row.total),
          collected: money(collectedIn.get(row.month) ?? null),
        })),
        (month) => ({
          month,
          taxable: money(null),
          vat: money(null),
          total: money(null),
          collected: money(collectedIn.get(month) ?? null),
        }),
      );
      const top = await this.repository.topCustomers(tx, companyId, from, to);
      return {
        year: chosen,
        years: await this.repository.years(tx, companyId),
        months,
        topCustomers: top.map((row) => ({
          partyId: row.partyId,
          name: row.name,
          taxable: money(row.taxable),
          open: money(row.open),
        })),
      };
    });
  }

  aging(today = businessToday()): Promise<AgingDto> {
    const { companyId } = companyOf(this.contexts.require());
    return this.db.run(async (tx) => {
      const rows = await this.repository.aging(tx, companyId, today);
      const byBucket = new Map(rows.map((row) => [row.bucket, row]));
      const total = rows.reduce((sum, row) => sum.add(row.amount ?? ZERO), ZERO);
      return {
        asOf: today,
        buckets: AGING_BUCKETS.map((bucket) => ({
          bucket,
          amount: money(byBucket.get(bucket)?.amount ?? null),
          count: Number(byBucket.get(bucket)?.count ?? 0),
        })),
        total: money(total),
      };
    });
  }
}
