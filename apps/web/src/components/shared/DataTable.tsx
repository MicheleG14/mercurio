import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from './EmptyState';
import { ErrorMessage } from './ErrorMessage';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isLoading: boolean;
  error: unknown;
  emptyTitle: string;
  /** Paging is done by the server (B16, F16): the table only shows the current page. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/**
 * The one table of the application (F16): handles the four states every screen must have
 * (loading, empty, error, content, F17) and the controls of a server-side paged list.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  emptyTitle,
  page,
  pageSize,
  total,
  onPageChange,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (error) return <ErrorMessage error={error} />;
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (!rows?.length) return <EmptyState title={emptyTitle} />;

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((column) => (
                <TableCell key={column.key} className={column.className}>
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{t('table.page', { page, pages, total })}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t('table.previous')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            {t('table.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
