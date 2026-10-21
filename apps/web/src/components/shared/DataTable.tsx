import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react';
import { Fragment, type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBreakpoint } from '@/lib/breakpoint';
import { EmptyState } from './EmptyState';
import { ErrorMessage } from './ErrorMessage';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** The field the server sorts on when this header is chosen; absent = not sortable. */
  sortField?: string;
  /**
   * Where the column goes when the list is shown as cards on a phone (F20): the title line, the
   * subtitle (joined with " · "), or the line of details under it. Columns without a place are
   * left out of the cards: the record shows them.
   */
  card?: 'title' | 'subtitle' | 'detail';
  /** False hides a secondary column on a tablet, where the width is shorter. */
  tablet?: boolean;
}

/** Order of a server-side list, as in `?sort=name:asc` (B16). */
export interface SortOrder {
  field: string;
  direction: 'asc' | 'desc';
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
  sort?: SortOrder;
  onSortChange?: (sort: SortOrder) => void;
}

/**
 * The one list of the application (F16): handles the four states every screen must have
 * (loading, empty, error, content, F17) and the controls of a server-side paged and sorted list.
 * A table on desktops and tablets (secondary columns hidden on a tablet), cards on a phone, from
 * the same columns (F20). Sortable headers are buttons (keyboard and screen readers, F5) and carry
 * `aria-sort`; on a phone the order is chosen from a select.
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
  sort,
  onSortChange,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const breakpoint = useBreakpoint();
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

  const shown = breakpoint === 'tablet' ? columns.filter((c) => c.tablet !== false) : columns;

  return (
    <div className="flex flex-col gap-3">
      {breakpoint === 'phone' ? (
        <>
          {sort && onSortChange && (
            <SortSelect columns={columns} sort={sort} onSortChange={onSortChange} />
          )}
          <Cards columns={columns} rows={rows} rowKey={rowKey} />
        </>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {shown.map((column) => {
                const active = column.sortField !== undefined && sort?.field === column.sortField;
                return (
                  <TableHead
                    key={column.key}
                    className={column.className}
                    aria-sort={
                      active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                  >
                    {column.sortField && onSortChange ? (
                      <SortButton
                        label={column.header}
                        direction={active ? sort.direction : undefined}
                        onClick={() =>
                          onSortChange({
                            field: column.sortField!,
                            direction: active && sort.direction === 'asc' ? 'desc' : 'asc',
                          })
                        }
                      />
                    ) : (
                      column.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {shown.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="flex items-center justify-between gap-2 text-sm">
        <Button
          variant="outline"
          size="sm"
          className="md:order-2"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {t('table.previous')}
        </Button>
        <span className="text-muted-foreground text-center md:order-1 md:mr-auto md:text-left">
          {t('table.page', { page, pages, total })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="md:order-3"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          {t('table.next')}
        </Button>
      </div>
    </div>
  );
}

/** One card per row, built from the columns that say where they go. */
function Cards<T>({
  columns,
  rows,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
}) {
  // The cells of each place, without the empty ones (a party with no city has no " · ").
  const cells = (row: T, where: Column<T>['card']) =>
    columns
      .filter((column) => column.card === where)
      .map((column) => ({ key: column.key, node: column.cell(row) }))
      .filter(({ node }) => node !== '' && node !== null && node !== undefined && node !== false);

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const [title, subtitle, detail] = [
          cells(row, 'title'),
          cells(row, 'subtitle'),
          cells(row, 'detail'),
        ];
        return (
          // `relative`: a link in the title can cover the whole card (after:absolute after:inset-0).
          <li
            key={rowKey(row)}
            className="border-border bg-card relative flex flex-col gap-1 rounded-lg border px-3.5 py-3"
          >
            <div className="font-medium">
              {title.map(({ key, node }) => (
                <Fragment key={key}>{node}</Fragment>
              ))}
            </div>
            {subtitle.length > 0 && (
              <div className="text-muted-foreground text-sm">
                {subtitle.map(({ key, node }, index) => (
                  <Fragment key={key}>
                    {index > 0 && ' · '}
                    {node}
                  </Fragment>
                ))}
              </div>
            )}
            {detail.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {detail.map(({ key, node }) => (
                  <span key={key}>{node}</span>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SortSelect<T>({
  columns,
  sort,
  onSortChange,
}: {
  columns: Column<T>[];
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const sortable = columns.filter((column) => column.sortField);
  if (sortable.length === 0) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        {t('table.sortBy')}
      </label>
      <NativeSelect
        id={id}
        className="flex-1"
        value={`${sort.field}:${sort.direction}`}
        onChange={(event) => {
          const [field, direction] = event.target.value.split(':');
          onSortChange({ field: field!, direction: direction as 'asc' | 'desc' });
        }}
      >
        {sortable.flatMap((column) =>
          (['asc', 'desc'] as const).map((direction) => (
            <NativeSelectOption
              key={`${column.key}:${direction}`}
              value={`${column.sortField}:${direction}`}
            >
              {t(`table.${direction}`, { column: column.header })}
            </NativeSelectOption>
          )),
        )}
      </NativeSelect>
    </div>
  );
}

function SortButton({
  label,
  direction,
  onClick,
}: {
  label: string;
  direction?: 'asc' | 'desc';
  onClick: () => void;
}) {
  const Icon =
    direction === 'asc' ? ArrowUpIcon : direction === 'desc' ? ArrowDownIcon : ArrowUpDownIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:text-foreground focus-visible:ring-ring/50 -mx-1 inline-flex items-center gap-1 rounded px-1 outline-none focus-visible:ring-3"
    >
      {label}
      <Icon
        aria-hidden="true"
        className={direction ? 'size-3.5' : 'text-muted-foreground size-3.5'}
      />
    </button>
  );
}
