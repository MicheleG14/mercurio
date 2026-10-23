import { ArrowRightIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar } from '@/components/shared/FilterBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { formatDate } from '@/lib/format';
import { useListParams } from '@/lib/list-params';
import { DOCUMENT_TYPES, isDocumentType } from './document-form';
import { useWarehouseRights } from './hooks';
import { NoWarehouses, WarehouseSelect } from './parts';
import { useStockDocuments, useWarehouses } from './queries';

/** `/stock/documents`: the stock documents of the company, newest first, filters in the URL. */
export function DocumentsPage() {
  const { t, i18n } = useTranslation('warehouse');
  const { write } = useWarehouseRights();
  const warehouses = useWarehouses();
  const list = useListParams(['type', 'warehouse', 'from', 'to'], {
    field: 'date',
    direction: 'desc',
  });
  const type = isDocumentType(list.filters.type ?? null) ? list.filters.type : undefined;
  const documents = useStockDocuments({
    page: list.page,
    q: list.q || undefined,
    sort: `${list.sort.field}:${list.sort.direction}`,
    type: type as (typeof DOCUMENT_TYPES)[number] | undefined,
    warehouseId: list.filters.warehouse || undefined,
    from: list.filters.from || undefined,
    to: list.filters.to || undefined,
  });

  const header = (
    <PageHeader
      title={t('documents.title')}
      description={t('documents.description')}
      actions={
        write &&
        warehouses.data?.items.length !== 0 && (
          <div className="flex flex-wrap gap-2">
            {DOCUMENT_TYPES.map((value, index) => (
              <Link
                key={value}
                to={`/stock/documents/new?type=${value}`}
                className={buttonVariants({ variant: index === 0 ? 'default' : 'outline' })}
              >
                <PlusIcon data-icon="inline-start" />
                {t(`newType.${value}`)}
              </Link>
            ))}
          </div>
        )
      }
    />
  );
  if (warehouses.data && warehouses.data.items.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <NoWarehouses />
      </div>
    );
  }

  const activeFilters = [type, list.filters.warehouse, list.filters.from, list.filters.to].filter(
    Boolean,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      {header}
      <FilterBar
        activeCount={activeFilters}
        search={
          <SearchInput
            value={list.q}
            onSearch={list.setQuery}
            label={t('documents.search')}
            placeholder={t('documents.search')}
          />
        }
      >
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('documents.filter.type')}</span>
          <NativeSelect
            value={type ?? ''}
            onChange={(event) => list.setFilter('type', event.target.value || undefined)}
          >
            <NativeSelectOption value="">{t('documents.filter.all')}</NativeSelectOption>
            {DOCUMENT_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(`type.${value}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <WarehouseSelect
          aria-label={t('common.warehouse')}
          warehouses={warehouses.data?.items ?? []}
          value={list.filters.warehouse ?? ''}
          onChange={(value) => list.setFilter('warehouse', value || undefined)}
          allowAll
        />
        {(['from', 'to'] as const).map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t(`documents.filter.${key}`)}</span>
            <Input
              type="date"
              className="w-auto"
              value={list.filters[key] ?? ''}
              onChange={(event) => list.setFilter(key, event.target.value || undefined)}
            />
          </label>
        ))}
      </FilterBar>
      <DataTable
        rows={documents.data?.items}
        rowKey={(row) => row.id}
        isLoading={documents.isPending}
        error={documents.error}
        emptyTitle={t('documents.empty')}
        page={documents.data?.page ?? list.page}
        pageSize={documents.data?.pageSize ?? 25}
        total={documents.data?.total ?? 0}
        onPageChange={list.setPage}
        sort={list.sort}
        onSortChange={list.setSort}
        columns={[
          {
            key: 'reference',
            header: t('documents.columns.reference'),
            sortField: 'number',
            card: 'title',
            cell: (row) => (
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/stock/documents/${row.id}`}
                  className="font-mono font-medium underline-offset-4 after:absolute after:inset-0 hover:underline md:after:hidden"
                >
                  {row.reference}
                </Link>
                {row.reversedBy && <Badge variant="secondary">{t('documents.reversed')}</Badge>}
              </span>
            ),
          },
          {
            key: 'date',
            header: t('documents.columns.date'),
            sortField: 'date',
            card: 'subtitle',
            className: 'tabular-nums',
            cell: (row) => formatDate(row.documentDate, i18n.language),
          },
          {
            key: 'reason',
            header: t('documents.columns.reason'),
            card: 'subtitle',
            cell: (row) =>
              row.reverses
                ? t('document.reverses', { reference: row.reverses.reference })
                : t(`reason.${row.reason as 'OPENING'}`),
          },
          {
            key: 'warehouse',
            header: t('documents.columns.warehouse'),
            card: 'detail',
            cell: (row) => (
              <span className="inline-flex items-center gap-1 font-mono">
                {row.warehouseCode}
                {row.targetWarehouseCode && (
                  <>
                    <ArrowRightIcon className="size-3.5" aria-label="→" />
                    {row.targetWarehouseCode}
                  </>
                )}
              </span>
            ),
          },
          {
            key: 'party',
            header: t('documents.columns.party'),
            card: 'detail',
            tablet: false,
            cell: (row) => row.partyName ?? '',
          },
          {
            key: 'lines',
            header: t('documents.columns.lines'),
            tablet: false,
            className: 'text-right tabular-nums',
            cell: (row) => t('documents.lineCount', { count: row.lineCount }),
          },
        ]}
      />
    </div>
  );
}
