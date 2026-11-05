import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/format';
import { uuidv7 } from '@/lib/uuid';
import { useInvoicingRights } from './hooks';
import { type ToInvoice, useCreateDraft, useToInvoice } from './queries';

/**
 * `/invoicing/to-invoice`: shipments of sales orders not yet invoiced, by customer. Choosing some
 * of one customer makes a draft with their lines (B33: the id is chosen here, once per click).
 */
export function ToInvoicePage() {
  const { t, i18n } = useTranslation('invoicing');
  const navigate = useNavigate();
  const { write } = useInvoicingRights();
  const shipments = useToInvoice({ page: 1 });
  const create = useCreateDraft();
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const rows = shipments.data?.items ?? [];
  const byCustomer = new Map<string, ToInvoice[]>();
  for (const row of rows)
    byCustomer.set(row.partyId, [...(byCustomer.get(row.partyId) ?? []), row]);
  const chosenRows = rows.filter((row) => chosen.has(row.fulfilmentId));
  const customers = new Set(chosenRows.map((row) => row.partyId));

  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const createInvoice = async () => {
    const draft = await create.mutateAsync({
      id: uuidv7(),
      fulfilmentIds: chosenRows.map((row) => row.fulfilmentId),
    });
    void navigate(`/invoicing/drafts/${draft.id}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('toInvoice.title')}
        description={t('toInvoice.description')}
        actions={
          write && (
            <Button
              disabled={chosenRows.length === 0 || customers.size > 1 || create.isPending}
              onClick={() => void createInvoice()}
            >
              {t('toInvoice.create')}
            </Button>
          )
        }
      />
      {create.error && <ErrorMessage error={create.error} />}
      {customers.size > 1 && (
        <p role="status" className="text-warning text-sm">
          {t('toInvoice.oneCustomer')}
        </p>
      )}
      {chosenRows.length > 0 && customers.size === 1 && (
        <p role="status" className="text-muted-foreground text-sm">
          {t('toInvoice.selected', { count: chosenRows.length })}
        </p>
      )}
      {shipments.error && <ErrorMessage error={shipments.error} />}
      {shipments.isPending && <Skeleton className="h-40 w-full" />}
      {!shipments.isPending && rows.length === 0 && <EmptyState title={t('toInvoice.empty')} />}
      {[...byCustomer].map(([partyId, list]) => (
        <section key={partyId} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{list[0]!.partyName}</h2>
          <ul className="border-border divide-border divide-y rounded-lg border">
            {list.map((row) => (
              <li
                key={row.fulfilmentId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
              >
                {write && (
                  <Checkbox
                    aria-label={`${t('toInvoice.choose')} ${row.documentReference}`}
                    disabled={Boolean(row.draftId)}
                    checked={chosen.has(row.fulfilmentId)}
                    onCheckedChange={(checked) => toggle(row.fulfilmentId, Boolean(checked))}
                  />
                )}
                <span className="font-mono font-medium">{row.documentReference}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatDate(row.documentDate, i18n.language)}
                </span>
                <Link
                  to={`/orders/${row.orderId}`}
                  className="font-mono underline-offset-4 hover:underline"
                >
                  {row.orderReference}
                </Link>
                {row.partyReference && (
                  <span className="text-muted-foreground">{row.partyReference}</span>
                )}
                <span className="ml-auto">
                  <MoneyAmount value={row.taxableAmount} />
                </span>
                {row.draftId && (
                  <Link
                    to={`/invoicing/drafts/${row.draftId}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {t('toInvoice.inDraft')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
