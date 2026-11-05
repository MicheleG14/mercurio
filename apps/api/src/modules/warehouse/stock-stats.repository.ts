import { Injectable } from '@nestjs/common';
import type { StockReason } from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';

/** Aggregates of the stock documents for the overview (docs/adr/0032). */
@Injectable()
export class StockStatsRepository {
  /** Documents per month and reason; a reversed document and its reversal are left out. */
  documentsByMonth(db: DbClient, companyId: string, from: string, to: string) {
    return db.$queryRaw<{ month: number; reason: StockReason; count: bigint }[]>`
      SELECT extract(month FROM d.document_date)::int AS month, d.reason, count(*) AS count
      FROM stock_documents d
      WHERE d.company_id = ${companyId}::uuid AND d.reason <> 'REVERSAL'
        AND d.document_date BETWEEN ${from}::date AND ${to}::date
        AND NOT EXISTS (SELECT 1 FROM stock_documents r WHERE r.reverses_id = d.id)
      GROUP BY 1, 2`;
  }

  async years(db: DbClient, companyId: string): Promise<number[]> {
    const rows = await db.$queryRaw<{ year: number }[]>`
      SELECT DISTINCT extract(year FROM document_date)::int AS year FROM stock_documents
      WHERE company_id = ${companyId}::uuid AND reason <> 'REVERSAL'
      ORDER BY 1 DESC`;
    return rows.map((row) => row.year);
  }
}
