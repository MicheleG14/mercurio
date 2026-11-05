import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard } from '@/components/shared/ChartCard';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { ChartContainer } from '@/components/ui/chart';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { chartValue, formatMoney, formatMoneyTick } from '@/lib/decimal';
import { businessToday } from '@/lib/format';
import { useAging, useInvoicingStats, useOrdersStats, useStockStats } from './queries';

/** Series colours, in their fixed order (validated: docs/conventions.md F23). */
const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'] as const;
const AGING = ['NOT_DUE', 'DAYS_1_30', 'DAYS_31_60', 'DAYS_61_90', 'OVER_90'] as const;

/** `YYYY-MM-DD` moved by whole days, in calendar terms (no time zone involved). */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthBounds(year: number, month: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

function monthName(year: number, month: number, language: string, width: 'short' | 'long') {
  return new Intl.DateTimeFormat(language, { month: width, timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

interface Series {
  key: string;
  label: string;
  color: string;
  /** The value as text: formatted from the API's string, never from the drawn number. */
  text: (raw: string) => string;
}

interface MonthRow {
  month: number;
  raw: Record<string, string>;
}

/**
 * Twelve months as columns: side by side, or stacked. One axis, in the unit of every series (two
 * measures of different units never share a chart). The hovered month shows every series.
 */
function MonthColumns({
  year,
  rows,
  series,
  stacked = false,
  money = true,
  onSelect,
}: {
  year: number;
  rows: MonthRow[];
  series: Series[];
  stacked?: boolean;
  money?: boolean;
  onSelect?: (month: number) => void;
}) {
  const { i18n } = useTranslation();
  const data = rows.map((row) => ({
    month: row.month,
    label: monthName(year, row.month, i18n.language, 'short'),
    raw: row.raw,
    ...Object.fromEntries(series.map((s) => [s.key, chartValue(row.raw[s.key] ?? '0')])),
  }));
  const config = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <BarChart data={data} accessibilityLayer barGap={2} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={4} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={money ? 72 : 32}
          allowDecimals={false}
          tickFormatter={(value: number) =>
            money ? formatMoneyTick(value, i18n.language) : String(value)
          }
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          content={({ active, payload }) => {
            const row = active ? payload?.[0]?.payload : undefined;
            if (!row) return null;
            return (
              <div className="bg-popover text-popover-foreground border-border grid min-w-40 gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-lg">
                <div className="font-medium capitalize">
                  {monthName(year, row.month, i18n.language, 'long')} {year}
                </div>
                {series.map((s) => (
                  <div key={s.key} className="flex items-center gap-2">
                    <span aria-hidden className="h-0.5 w-3" style={{ background: s.color }} />
                    <span className="font-semibold tabular-nums">{s.text(row.raw[s.key])}</span>
                    <span className="text-muted-foreground">{s.label}</span>
                  </div>
                ))}
              </div>
            );
          }}
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color}
            maxBarSize={24}
            stackId={stacked ? 'month' : undefined}
            // Rounded data end, square at the baseline; in a stack only the top segment.
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
            // The 2px gap between touching fills, in the card's colour.
            stroke={stacked ? 'var(--card)' : undefined}
            strokeWidth={stacked ? 2 : 0}
            cursor={onSelect ? 'pointer' : undefined}
            onClick={onSelect ? (entry) => onSelect((entry.payload as MonthRow).month) : undefined}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** Ranked bars in one hue, largest first: names and amounts as text, the bar beside them. */
function RankedList({
  rows,
}: {
  rows: { key: string; name: string; to: string; value: string; note?: string }[];
}) {
  const max = Math.max(...rows.map((row) => chartValue(row.value)), 0);
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <Link to={row.to} className="min-w-0 truncate underline-offset-4 hover:underline">
              {row.name}
            </Link>
            <span className="shrink-0 text-right">
              <MoneyAmount value={row.value} className="font-medium" />
              {row.note && <span className="text-muted-foreground block text-xs">{row.note}</span>}
            </span>
          </div>
          <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
            <div
              className="h-full rounded-full"
              style={{
                width: `${max > 0 ? (chartValue(row.value) / max) * 100 : 0}%`,
                background: SERIES[0],
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The charts of the overview (docs/adr/0032), loaded apart from the page: the counters above
 * them show at once, the chart library arrives after. One year for all of them, chosen in one row
 * above the charts; each module shows only with its module on and its read permission.
 */
export default function OverviewCharts({
  invoicing,
  orders,
  warehouse,
}: {
  invoicing: boolean;
  orders: boolean;
  warehouse: boolean;
}) {
  const { t, i18n } = useTranslation('home');
  const navigate = useNavigate();
  const today = businessToday();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const invoicingStats = useInvoicingStats(year, invoicing).data;
  const aging = useAging(invoicing).data;
  const ordersStats = useOrdersStats(year, orders).data;
  const stockStats = useStockStats(year, warehouse).data;
  const money = (raw: string) => formatMoney(raw, i18n.language, 2);
  const years = [
    ...new Set([
      Number(today.slice(0, 4)),
      year,
      ...(invoicingStats?.years ?? []),
      ...(ordersStats?.years ?? []),
      ...(stockStats?.years ?? []),
    ]),
  ].sort((a, b) => b - a);
  const monthCell = (month: number) => (
    <span className="capitalize">{monthName(year, month, i18n.language, 'long')}</span>
  );
  const noData = t('charts.empty', { year });

  const agingLink = (bucket: (typeof AGING)[number], asOf: string) => {
    const range: Record<typeof bucket, [number | null, number | null]> = {
      NOT_DUE: [0, null],
      DAYS_1_30: [-30, -1],
      DAYS_31_60: [-60, -31],
      DAYS_61_90: [-90, -61],
      OVER_90: [null, -91],
    };
    const [from, to] = range[bucket];
    const params = new URLSearchParams(bucket === 'NOT_DUE' ? {} : { status: 'overdue' });
    if (from !== null) params.set('from', shiftDate(asOf, from));
    if (to !== null) params.set('to', shiftDate(asOf, to));
    return `/invoicing/due-dates?${params.toString()}`;
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="overview-trends">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="overview-trends" className="text-lg font-semibold">
          {t('charts.title')}
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('charts.year')}</span>
          <NativeSelect value={year} onChange={(event) => setYear(Number(event.target.value))}>
            {years.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {invoicing && invoicingStats && (
          <>
            <ChartCard
              className="lg:col-span-2"
              title={t('charts.invoiced.title', { year })}
              description={t('charts.invoiced.description')}
              legend={[
                { label: t('charts.invoiced.total'), color: SERIES[0] },
                { label: t('charts.invoiced.collected'), color: SERIES[1] },
              ]}
              empty={
                invoicingStats.months.every((m) => m.total === '0.00' && m.collected === '0.00') &&
                noData
              }
              table={{
                columns: [
                  t('charts.month'),
                  t('charts.invoiced.taxable'),
                  t('charts.invoiced.total'),
                  t('charts.invoiced.collected'),
                ],
                rows: invoicingStats.months.map((m) => {
                  const { from, to } = monthBounds(year, m.month);
                  return {
                    key: String(m.month),
                    cells: [
                      <Link
                        key="month"
                        to={`/invoicing/invoices?from=${from}&to=${to}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {monthCell(m.month)}
                      </Link>,
                      <MoneyAmount key="taxable" value={m.taxable} />,
                      <MoneyAmount key="total" value={m.total} />,
                      <MoneyAmount key="collected" value={m.collected} />,
                    ],
                  };
                }),
              }}
            >
              <MonthColumns
                year={year}
                rows={invoicingStats.months.map((m) => ({
                  month: m.month,
                  raw: { total: m.total, collected: m.collected },
                }))}
                series={[
                  {
                    key: 'total',
                    label: t('charts.invoiced.total'),
                    color: SERIES[0],
                    text: money,
                  },
                  {
                    key: 'collected',
                    label: t('charts.invoiced.collected'),
                    color: SERIES[1],
                    text: money,
                  },
                ]}
                onSelect={(month) => {
                  const { from, to } = monthBounds(year, month);
                  void navigate(`/invoicing/invoices?from=${from}&to=${to}`);
                }}
              />
            </ChartCard>

            {aging && (
              <ChartCard
                title={t('charts.aging.title')}
                description={t('charts.aging.description', { total: money(aging.total) })}
                empty={aging.total === '0.00' && t('charts.aging.empty')}
                table={{
                  columns: [t('charts.aging.bucket'), t('charts.aging.amount'), t('charts.count')],
                  rows: aging.buckets.map((b) => ({
                    key: b.bucket,
                    cells: [
                      <Link
                        key="bucket"
                        to={agingLink(b.bucket, aging.asOf)}
                        className="underline-offset-4 hover:underline"
                      >
                        {t(`charts.aging.buckets.${b.bucket}`)}
                      </Link>,
                      <MoneyAmount key="amount" value={b.amount} />,
                      b.count,
                    ],
                  })),
                }}
              >
                <ChartContainer
                  config={{ amount: { label: t('charts.aging.amount'), color: SERIES[0] } }}
                  className="aspect-auto h-56 w-full"
                >
                  <BarChart
                    layout="vertical"
                    data={aging.buckets.map((b) => ({
                      ...b,
                      label: t(`charts.aging.buckets.${b.bucket}`),
                      value: chartValue(b.amount),
                      text: money(b.amount),
                    }))}
                    margin={{ left: 4, right: 96 }}
                    accessibilityLayer
                  >
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      width={112}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--muted)' }}
                      content={({ active, payload }) => {
                        const row = active ? payload?.[0]?.payload : undefined;
                        if (!row) return null;
                        return (
                          <div className="bg-popover text-popover-foreground border-border grid gap-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-lg">
                            <span className="font-semibold tabular-nums">{row.text}</span>
                            <span className="text-muted-foreground">
                              {row.label} · {t('charts.aging.dueDates', { count: row.count })}
                            </span>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="value"
                      fill={SERIES[0]}
                      maxBarSize={24}
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(entry) =>
                        void navigate(
                          agingLink(
                            (entry.payload as { bucket: (typeof AGING)[number] }).bucket,
                            aging.asOf,
                          ),
                        )
                      }
                    >
                      <LabelList
                        dataKey="text"
                        position="right"
                        className="fill-foreground tabular-nums"
                        fontSize={12}
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </ChartCard>
            )}

            <ChartCard
              title={t('charts.customers.title', { year })}
              description={t('charts.customers.description')}
              empty={invoicingStats.topCustomers.length === 0 && noData}
              table={{
                columns: [
                  t('charts.customers.customer'),
                  t('charts.customers.taxable'),
                  t('charts.customers.open'),
                ],
                rows: invoicingStats.topCustomers.map((c) => ({
                  key: c.partyId,
                  cells: [
                    c.name,
                    <MoneyAmount key="taxable" value={c.taxable} />,
                    <MoneyAmount key="open" value={c.open} />,
                  ],
                })),
              }}
            >
              <RankedList
                rows={invoicingStats.topCustomers.map((c) => ({
                  key: c.partyId,
                  name: c.name,
                  to: `/parties/${c.partyId}`,
                  value: c.taxable,
                  note: t('charts.customers.openNote', { amount: money(c.open) }),
                }))}
              />
            </ChartCard>
          </>
        )}

        {orders && ordersStats && (
          <>
            <ChartCard
              title={t('charts.orders.title', { year })}
              description={t('charts.orders.description')}
              legend={[
                { label: t('charts.orders.ordered'), color: SERIES[0] },
                { label: t('charts.orders.shipped'), color: SERIES[1] },
              ]}
              empty={
                ordersStats.months.every((m) => m.ordered === '0.00' && m.shipped === '0.00') &&
                noData
              }
              table={{
                columns: [
                  t('charts.month'),
                  t('charts.orders.ordered'),
                  t('charts.orders.shipped'),
                ],
                rows: ordersStats.months.map((m) => ({
                  key: String(m.month),
                  cells: [
                    monthCell(m.month),
                    <MoneyAmount key="ordered" value={m.ordered} />,
                    <MoneyAmount key="shipped" value={m.shipped} />,
                  ],
                })),
              }}
            >
              <MonthColumns
                year={year}
                rows={ordersStats.months.map((m) => ({
                  month: m.month,
                  raw: { ordered: m.ordered, shipped: m.shipped },
                }))}
                series={[
                  {
                    key: 'ordered',
                    label: t('charts.orders.ordered'),
                    color: SERIES[0],
                    text: money,
                  },
                  {
                    key: 'shipped',
                    label: t('charts.orders.shipped'),
                    color: SERIES[1],
                    text: money,
                  },
                ]}
              />
            </ChartCard>
            <ChartCard
              title={t('charts.backlog.title')}
              description={t('charts.backlog.description')}
              empty={ordersStats.backlog === '0.00' && t('charts.backlog.empty')}
              table={{
                columns: [t('charts.customers.customer'), t('charts.backlog.amount')],
                rows: ordersStats.backlogCustomers.map((c) => ({
                  key: c.partyId,
                  cells: [c.name, <MoneyAmount key="amount" value={c.amount} />],
                })),
              }}
            >
              <p className="flex flex-col">
                <span className="text-muted-foreground text-sm">{t('charts.backlog.total')}</span>
                <MoneyAmount value={ordersStats.backlog} className="text-3xl font-semibold" />
              </p>
              <RankedList
                rows={ordersStats.backlogCustomers.map((c) => ({
                  key: c.partyId,
                  name: c.name,
                  to: '/orders/sales?status=OPEN',
                  value: c.amount,
                }))}
              />
            </ChartCard>
          </>
        )}

        {warehouse && stockStats && (
          <ChartCard
            className="lg:col-span-2"
            title={t('charts.stock.title', { year })}
            description={t('charts.stock.description')}
            legend={[
              { label: t('charts.stock.receipt'), color: SERIES[0] },
              { label: t('charts.stock.issue'), color: SERIES[1] },
              { label: t('charts.stock.other'), color: SERIES[2] },
            ]}
            empty={
              stockStats.months.every(
                (m) => m.receipt + m.issue + m.adjustment + m.transfer === 0,
              ) && noData
            }
            table={{
              columns: [
                t('charts.month'),
                t('charts.stock.receipt'),
                t('charts.stock.issue'),
                t('charts.stock.adjustment'),
                t('charts.stock.transfer'),
              ],
              rows: stockStats.months.map((m) => {
                const { from, to } = monthBounds(year, m.month);
                return {
                  key: String(m.month),
                  cells: [
                    <Link
                      key="month"
                      to={`/stock/documents?from=${from}&to=${to}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {monthCell(m.month)}
                    </Link>,
                    m.receipt,
                    m.issue,
                    m.adjustment,
                    m.transfer,
                  ],
                };
              }),
            }}
          >
            <MonthColumns
              year={year}
              money={false}
              stacked
              rows={stockStats.months.map((m) => ({
                month: m.month,
                raw: {
                  receipt: String(m.receipt),
                  issue: String(m.issue),
                  other: String(m.adjustment + m.transfer),
                },
              }))}
              series={[
                {
                  key: 'receipt',
                  label: t('charts.stock.receipt'),
                  color: SERIES[0],
                  text: String,
                },
                { key: 'issue', label: t('charts.stock.issue'), color: SERIES[1], text: String },
                { key: 'other', label: t('charts.stock.other'), color: SERIES[2], text: String },
              ]}
              onSelect={(month) => {
                const { from, to } = monthBounds(year, month);
                void navigate(`/stock/documents?from=${from}&to=${to}`);
              }}
            />
          </ChartCard>
        )}
      </div>
    </section>
  );
}
