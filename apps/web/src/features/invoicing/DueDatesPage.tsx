import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar } from '@/components/shared/FilterBar';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { formatDate } from '@/lib/format';
import { useListParams } from '@/lib/list-params';
import { useInvoicingRights } from './hooks';
import { type DueDatesQuery, useDueDates } from './queries';

const STATUSES = ['open', 'overdue', 'paid', 'all'] as const;
type Status = (typeof STATUSES)[number];
const isStatus = (value: string | undefined): value is Status => STATUSES.includes(value as never);

/** `/invoicing/due-dates`: the payment schedule, open due dates first by date, with totals. */
export function DueDatesPage() {
  const { t, i18n } = useTranslation('invoicing');
  const { pay } = useInvoicingRights();
  const list = useListParams(['status'], { field: 'date', direction: 'asc' });
  const status: Status = isStatus(list.filters.status) ? list.filters.status : 'open';
  const query: DueDatesQuery = { page: list.page, status: status === 'all' ? undefined : status };
  const dueDates = useDueDates(query);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('dueDates.title')} description={t('dueDates.description')} />
      <dl className="flex flex-wrap gap-8">
        <div>
          <dt className="text-muted-foreground text-sm">{t('dueDates.openTotal')}</dt>
          <dd className="text-2xl font-semibold">
            <MoneyAmount value={dueDates.data?.openTotal ?? '0.00'} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm">{t('dueDates.overdueTotal')}</dt>
          <dd className="text-2xl font-semibold">
            <MoneyAmount value={dueDates.data?.overdueTotal ?? '0.00'} />
          </dd>
        </div>
      </dl>
      <FilterBar activeCount={status === 'open' ? 0 : 1} search={null}>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('dueDates.filter.status')}</span>
          <NativeSelect
            value={status}
            onChange={(event) =>
              list.setFilter(
                'status',
                event.target.value === 'open' ? undefined : event.target.value,
              )
            }
          >
            {STATUSES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(`dueDates.filter.${value}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </FilterBar>
      <DataTable
        rows={dueDates.data?.items}
        rowKey={(row) => row.dueDateId}
        isLoading={dueDates.isPending}
        error={dueDates.error}
        emptyTitle={t('dueDates.empty')}
        page={dueDates.data?.page ?? list.page}
        pageSize={dueDates.data?.pageSize ?? 50}
        total={dueDates.data?.total ?? 0}
        onPageChange={list.setPage}
        columns={[
          {
            key: 'date',
            header: t('dueDates.columns.date'),
            card: 'title',
            className: 'tabular-nums',
            cell: (row) => (
              <span className="flex items-center gap-2">
                {formatDate(row.dueDate, i18n.language)}
                {row.overdue && <Badge variant="warning">{t('overdue')}</Badge>}
              </span>
            ),
          },
          {
            key: 'document',
            header: t('dueDates.columns.document'),
            card: 'subtitle',
            cell: (row) => (
              <Link
                to={`/invoicing/invoices/${row.invoiceId}`}
                className="font-mono underline-offset-4 hover:underline"
              >
                {row.reference}
              </Link>
            ),
          },
          {
            key: 'customer',
            header: t('dueDates.columns.customer'),
            card: 'subtitle',
            className: 'max-w-xs truncate',
            cell: (row) => row.partyName,
          },
          {
            key: 'amount',
            header: t('dueDates.columns.amount'),
            tablet: false,
            className: 'text-right',
            cell: (row) => <MoneyAmount value={row.amount} />,
          },
          {
            key: 'open',
            header: t('dueDates.columns.open'),
            card: 'detail',
            className: 'text-right',
            cell: (row) => (
              <MoneyAmount
                value={row.kind === 'CREDIT_NOTE' ? `-${row.openAmount}` : row.openAmount}
              />
            ),
          },
          {
            key: 'pay',
            header: '',
            card: 'detail',
            cell: (row) =>
              pay && row.openAmount !== '0.00' ? (
                <Link
                  to={`/invoicing/payments/new?party=${row.partyId}&kind=${row.kind === 'CREDIT_NOTE' ? 'REFUND' : 'RECEIPT'}`}
                  className="text-primary relative z-10 underline-offset-4 hover:underline"
                >
                  {row.kind === 'CREDIT_NOTE' ? t('dueDates.refund') : t('dueDates.pay')}
                </Link>
              ) : null,
          },
        ]}
      />
    </div>
  );
}
