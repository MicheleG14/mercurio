import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar } from '@/components/shared/FilterBar';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { buttonVariants } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { formatDate } from '@/lib/format';
import { useListParams } from '@/lib/list-params';
import { useInvoicingRights } from './hooks';
import { PaymentStatusBadges } from './parts';
import { type InvoiceKind, useDrafts, useInvoices } from './queries';

const KINDS = ['INVOICE', 'CREDIT_NOTE'] as const;
const isKind = (value: string | undefined): value is InvoiceKind => KINDS.includes(value as never);

/** `/invoicing/invoices`: the drafts being prepared, then the issued documents, newest first. */
export function InvoicesPage() {
  const { t, i18n } = useTranslation('invoicing');
  const { write } = useInvoicingRights();
  const list = useListParams(['kind'], { field: 'date', direction: 'desc' });
  const kind = isKind(list.filters.kind) ? list.filters.kind : undefined;
  const invoices = useInvoices({ page: list.page, q: list.q || undefined, kind });
  const drafts = useDrafts(1);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={
          write && (
            <Link to="/invoicing/new" className={buttonVariants()}>
              <PlusIcon data-icon="inline-start" />
              {t('list.new')}
            </Link>
          )
        }
      />

      {(drafts.data?.items.length ?? 0) > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t('list.drafts')}</h2>
          <ul className="border-border divide-border divide-y rounded-lg border">
            {drafts.data!.items.map((draft) => (
              <li key={draft.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                <Link
                  to={`/invoicing/drafts/${draft.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {t(`kind.${draft.kind}`)} · {t('draft')}
                </Link>
                <span className="text-muted-foreground min-w-0 flex-1 truncate">
                  {draft.partyName ?? t('list.noCustomer')}
                </span>
                <MoneyAmount value={draft.total} />
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatDate(draft.updatedAt.slice(0, 10), i18n.language)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <FilterBar
        activeCount={kind ? 1 : 0}
        search={
          <SearchInput
            value={list.q}
            onSearch={list.setQuery}
            label={t('list.search')}
            placeholder={t('list.search')}
          />
        }
      >
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('list.filter.kind')}</span>
          <NativeSelect
            value={kind ?? ''}
            onChange={(event) => list.setFilter('kind', event.target.value || undefined)}
          >
            <NativeSelectOption value="">{t('list.filter.all')}</NativeSelectOption>
            {KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(`kind.${value}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </FilterBar>
      <DataTable
        rows={invoices.data?.items}
        rowKey={(row) => row.id}
        isLoading={invoices.isPending}
        error={invoices.error}
        emptyTitle={t('list.empty')}
        page={invoices.data?.page ?? list.page}
        pageSize={invoices.data?.pageSize ?? 25}
        total={invoices.data?.total ?? 0}
        onPageChange={list.setPage}
        columns={[
          {
            key: 'number',
            header: t('list.columns.number'),
            card: 'title',
            cell: (row) => (
              <Link
                to={`/invoicing/invoices/${row.id}`}
                className="font-mono font-medium underline-offset-4 after:absolute after:inset-0 hover:underline md:after:hidden"
              >
                {row.reference}
              </Link>
            ),
          },
          {
            key: 'date',
            header: t('list.columns.date'),
            card: 'subtitle',
            className: 'tabular-nums',
            cell: (row) => formatDate(row.issueDate, i18n.language),
          },
          {
            key: 'customer',
            header: t('list.columns.customer'),
            card: 'subtitle',
            className: 'max-w-xs truncate',
            cell: (row) => row.partyName,
          },
          {
            key: 'total',
            header: t('list.columns.total'),
            card: 'detail',
            className: 'text-right',
            cell: (row) => <MoneyAmount value={row.total} />,
          },
          {
            key: 'open',
            header: t('list.columns.open'),
            tablet: false,
            className: 'text-right',
            cell: (row) =>
              row.openAmount === '0.00' ? '' : <MoneyAmount value={row.openAmount} />,
          },
          {
            key: 'due',
            header: t('list.columns.due'),
            tablet: false,
            className: 'tabular-nums',
            cell: (row) => (row.nextDueDate ? formatDate(row.nextDueDate, i18n.language) : ''),
          },
          {
            key: 'status',
            header: t('list.columns.status'),
            card: 'detail',
            cell: (row) => <PaymentStatusBadges status={row.paymentStatus} overdue={row.overdue} />,
          },
        ]}
      />
    </div>
  );
}
