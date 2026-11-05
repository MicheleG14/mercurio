import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable } from '@/components/shared/DataTable';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { useListParams } from '@/lib/list-params';
import { useInvoicingRights } from './hooks';
import { type Payment, usePayments, useReversePayment } from './queries';

/** `/invoicing/payments`: payments and refunds, newest first; one can be undone. */
export function PaymentsPage() {
  const { t, i18n } = useTranslation('invoicing');
  const { pay } = useInvoicingRights();
  const list = useListParams([], { field: 'date', direction: 'desc' });
  const payments = usePayments({ page: list.page });
  const reverse = useReversePayment();
  const [undoing, setUndoing] = useState<Payment | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('payments.title')}
        description={t('payments.description')}
        actions={
          pay && (
            <Link to="/invoicing/payments/new" className={buttonVariants()}>
              <PlusIcon data-icon="inline-start" />
              {t('payments.new')}
            </Link>
          )
        }
      />
      {reverse.error && <ErrorMessage error={reverse.error} />}
      <DataTable
        rows={payments.data?.items}
        rowKey={(row) => row.id}
        isLoading={payments.isPending}
        error={payments.error}
        emptyTitle={t('payments.empty')}
        page={payments.data?.page ?? list.page}
        pageSize={payments.data?.pageSize ?? 25}
        total={payments.data?.total ?? 0}
        onPageChange={list.setPage}
        columns={[
          {
            key: 'date',
            header: t('payments.columns.date'),
            card: 'title',
            className: 'tabular-nums',
            cell: (row) => (
              <span className="flex flex-wrap items-center gap-2">
                {formatDate(row.paymentDate, i18n.language)}
                {row.kind === 'REFUND' && (
                  <Badge variant="secondary">{t('payments.kind.REFUND')}</Badge>
                )}
                {row.reversesId && <Badge variant="secondary">{t('payments.reversal')}</Badge>}
                {row.reversedById && <Badge variant="secondary">{t('payments.reversed')}</Badge>}
              </span>
            ),
          },
          {
            key: 'customer',
            header: t('payments.columns.customer'),
            card: 'subtitle',
            className: 'max-w-xs truncate',
            cell: (row) => row.partyName,
          },
          {
            key: 'documents',
            header: t('payments.columns.documents'),
            tablet: false,
            cell: (row) => (
              <span className="flex flex-wrap gap-x-2 font-mono text-xs">
                {[...new Map(row.allocations.map((a) => [a.invoiceId, a])).values()].map((a) => (
                  <Link
                    key={a.invoiceId}
                    to={`/invoicing/invoices/${a.invoiceId}`}
                    className="relative z-10 underline-offset-4 hover:underline"
                  >
                    {a.reference}
                  </Link>
                ))}
              </span>
            ),
          },
          {
            key: 'method',
            header: t('payments.columns.method'),
            tablet: false,
            cell: (row) => t(`methods.${row.method as 'MP05'}`),
          },
          {
            key: 'amount',
            header: t('payments.columns.amount'),
            card: 'detail',
            className: 'text-right',
            cell: (row) => <MoneyAmount value={row.reversesId ? `-${row.amount}` : row.amount} />,
          },
          {
            key: 'actions',
            header: '',
            card: 'detail',
            cell: (row) =>
              pay && !row.reversesId && !row.reversedById ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="relative z-10"
                  onClick={() => setUndoing(row)}
                >
                  {t('payments.reverse')}
                </Button>
              ) : null,
          },
        ]}
      />
      <ConfirmDialog
        open={undoing !== null}
        title={t('payments.reverseTitle')}
        description={t('payments.reverseDescription')}
        confirmLabel={t('payments.reverse')}
        destructive
        pending={reverse.isPending}
        onConfirm={() => void reverse.mutateAsync(undoing!.id).finally(() => setUndoing(null))}
        onCancel={() => setUndoing(null)}
      />
    </div>
  );
}
