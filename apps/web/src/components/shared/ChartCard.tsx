import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface ChartLegendItem {
  label: string;
  /** A CSS colour, normally a chart token: `var(--chart-1)`. */
  color: string;
}

export interface ChartTable {
  columns: string[];
  rows: { key: string; cells: ReactNode[] }[];
}

/**
 * A chart with what every chart of the app needs (F23): a title that says what it measures, a
 * legend when there is more than one series (the swatch beside the name, never coloured text),
 * the same figures as a table one click away, and an empty state instead of a flat chart.
 */
export function ChartCard({
  title,
  description,
  legend,
  table,
  empty,
  className,
  children,
}: {
  title: string;
  description?: string;
  legend?: ChartLegendItem[];
  table: ChartTable;
  /** Shown instead of the chart and the table when there is nothing to draw. */
  empty?: string | false;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();

  return (
    <Card className={cn('min-w-0', className)} aria-labelledby={titleId}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle id={titleId}>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {!empty && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={asTable}
            onClick={() => setAsTable((value) => !value)}
          >
            {asTable ? t('charts.showChart') : t('charts.showTable')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {empty ? (
          <p className="text-muted-foreground py-8 text-center text-sm">{empty}</p>
        ) : asTable ? (
          <Table aria-labelledby={titleId}>
            <TableHeader>
              <TableRow>
                {table.columns.map((column, i) => (
                  <TableHead key={column} className={i > 0 ? 'text-right' : undefined}>
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((row) => (
                <TableRow key={row.key}>
                  {row.cells.map((cell, i) => (
                    <TableCell key={i} className={i > 0 ? 'text-right tabular-nums' : undefined}>
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <>
            {legend && legend.length > 1 && (
              <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {legend.map((item) => (
                  <li key={item.label} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-[2px]"
                      style={{ background: item.color }}
                    />
                    {item.label}
                  </li>
                ))}
              </ul>
            )}
            {children}
          </>
        )}
      </CardContent>
    </Card>
  );
}
