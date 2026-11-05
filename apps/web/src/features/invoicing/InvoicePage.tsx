import { FileDownIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { formatQuantity } from '@/lib/decimal';
import { formatDate } from '@/lib/format';
import { uuidv7 } from '@/lib/uuid';
import { useInvoicingRights, usePaymentTermsLabel, useVatLabel } from './hooks';
import { DocumentTotals, PaymentStatusBadges } from './parts';
import { type Invoice, useCreditNote, useInvoice, usePdf } from './queries';

/** A seller or a customer as the document printed it. */
interface PrintedParty {
  name?: string;
  legalName?: string;
  vatNumber?: string | null;
  taxCode?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  sdiCode?: string | null;
  pecEmail?: string | null;
}

/** `/invoicing/invoices/:id`: an issued document, read only; its PDF, credit notes, payments. */
export function InvoicePage() {
  const { id = '' } = useParams();
  const invoice = useInvoice(id);
  if (invoice.error) return <ErrorMessage error={invoice.error} />;
  if (invoice.isPending) return <Skeleton className="h-64 w-full" />;
  return <InvoiceView invoice={invoice.data} />;
}

function InvoiceView({ invoice }: { invoice: Invoice }) {
  const { t, i18n } = useTranslation('invoicing');
  const { t: tc } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const rights = useInvoicingRights();
  const termsLabel = usePaymentTermsLabel();
  const vatLabel = useVatLabel();
  const pdf = usePdf();
  const creditNote = useCreditNote(invoice.id);
  const [crediting, setCrediting] = useState(false);
  const [creditLines, setCreditLines] = useState<Set<string>>(new Set());
  const creditable = invoice.creditable.filter((line) => line.amount !== '0.00');
  const seller = invoice.seller as PrintedParty;
  const customer = invoice.customer as PrintedParty;
  const refund = invoice.kind === 'CREDIT_NOTE';

  const makeCreditNote = async () => {
    const draft = await creditNote.mutateAsync({
      id: uuidv7(),
      ...(creditLines.size > 0 ? { lineIds: [...creditLines] } : {}),
    });
    void navigate(`/invoicing/drafts/${draft.id}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('detail.number', {
          kind: t(`kind.${invoice.kind}`),
          reference: invoice.reference,
        })}
        description={t('detail.issued', { date: formatDate(invoice.issueDate, language) })}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={pdf.isPending}
              onClick={() => pdf.mutate({ kind: 'invoice', id: invoice.id })}
            >
              <FileDownIcon data-icon="inline-start" />
              {t('detail.pdf')}
            </Button>
            {rights.write && !refund && creditable.length > 0 && (
              <Button variant="outline" onClick={() => setCrediting(true)}>
                {t('detail.creditNote')}
              </Button>
            )}
            {rights.pay && invoice.openAmount !== '0.00' && (
              <Link
                to={`/invoicing/payments/new?party=${invoice.partyId}&kind=${refund ? 'REFUND' : 'RECEIPT'}`}
                className={buttonVariants()}
              >
                {refund ? t('detail.recordRefund') : t('detail.recordPayment')}
              </Link>
            )}
          </div>
        }
      />
      {(pdf.error ?? creditNote.error) && <ErrorMessage error={pdf.error ?? creditNote.error} />}
      <PaymentStatusBadges status={invoice.paymentStatus} overdue={invoice.overdue} />
      {crediting && (
        <section className="border-border flex flex-col gap-3 rounded-lg border p-3 text-sm">
          <h2 className="font-medium">{t('detail.creditDialog.title')}</h2>
          <p className="text-muted-foreground">{t('detail.creditDialog.description')}</p>
          {invoice.lines
            .filter((line) => creditable.some((c) => c.lineId === line.id))
            .map((line) => (
              <label key={line.id} className="flex items-center gap-2">
                <Checkbox
                  checked={creditLines.has(line.id)}
                  onCheckedChange={(checked) =>
                    setCreditLines((current) => {
                      const next = new Set(current);
                      if (checked) next.add(line.id);
                      else next.delete(line.id);
                      return next;
                    })
                  }
                />
                {line.description}
              </label>
            ))}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setCrediting(false)}>
              {tc('actions.cancel')}
            </Button>
            <Button disabled={creditNote.isPending} onClick={() => void makeCreditNote()}>
              {creditLines.size > 0 ? t('detail.creditLines') : t('detail.creditAll')}
            </Button>
          </div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {(
          [
            [t('detail.seller'), seller.legalName, seller],
            [t('detail.customer'), customer.name, customer],
          ] as const
        ).map(([title, name, party]) => (
          <section key={title} className="flex flex-col gap-0.5 text-sm">
            <h2 className="text-muted-foreground text-xs font-medium uppercase">{title}</h2>
            <p className="font-medium">{name}</p>
            {party.address && <p>{party.address}</p>}
            <p>{[party.postalCode, party.city, party.province].filter(Boolean).join(' ')}</p>
            {party.vatNumber && <p className="font-mono">{party.vatNumber}</p>}
          </section>
        ))}
      </div>

      {invoice.creditedInvoice && (
        <p className="text-sm">
          {t('detail.creditedInvoice')}{' '}
          <Link
            to={`/invoicing/invoices/${invoice.creditedInvoice.id}`}
            className="font-mono underline-offset-4 hover:underline"
          >
            {invoice.creditedInvoice.reference}
          </Link>
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t('detail.lines')}</h2>
        <ul className="border-border divide-border divide-y rounded-lg border text-sm">
          {invoice.lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
              {line.itemCode && <span className="font-mono">{line.itemCode}</span>}
              <span className="min-w-0 flex-1">{line.description}</span>
              {line.quantity && (
                <span className="tabular-nums">
                  {formatQuantity(line.quantity, language)} {line.unit ?? ''}
                </span>
              )}
              {line.unitPrice && <MoneyAmount value={line.unitPrice} price />}
              {line.discountPercent !== '0.00' && line.quantity && (
                <span className="text-muted-foreground">−{line.discountPercent}%</span>
              )}
              {line.vatCode && (
                <span className="text-muted-foreground">
                  {line.vatNature ? line.vatNature : `${line.vatCode}%`}
                </span>
              )}
              {line.lineAmount && <MoneyAmount value={line.lineAmount} className="font-medium" />}
            </li>
          ))}
        </ul>
      </section>

      <DocumentTotals
        rows={invoice.vatSummary}
        taxableTotal={invoice.taxableTotal}
        vatTotal={invoice.vatTotal}
        total={invoice.total}
        stampDuty={invoice.stampDuty}
      />
      <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
        {invoice.vatSummary
          .filter((row) => row.nature)
          .map((row) => (
            <li key={row.vatCode}>{vatLabel(row.vatCode, row.nature)}</li>
          ))}
      </ul>

      <p className="text-sm">
        {t('detail.payment', {
          terms: termsLabel(invoice.paymentTerms),
          method: t(`methods.${invoice.paymentMethod as 'MP05'}`),
        })}
        {invoice.iban && invoice.paymentMethod === 'MP05' && (
          <span className="font-mono"> · {invoice.iban}</span>
        )}
      </p>

      {invoice.dueDates.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t('detail.dueDates')}</h2>
          <table className="w-full max-w-xl text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-1 font-medium">{t('detail.dueColumns.date')}</th>
                <th className="py-1 text-right font-medium">{t('detail.dueColumns.amount')}</th>
                <th className="py-1 text-right font-medium">{t('detail.dueColumns.settled')}</th>
                <th className="py-1 text-right font-medium">{t('detail.dueColumns.open')}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.dueDates.map((due) => (
                <tr key={due.id} className="border-border border-t">
                  <td className="py-1 tabular-nums">{formatDate(due.dueDate, language)}</td>
                  <td className="py-1 text-right">
                    <MoneyAmount value={due.amount} />
                  </td>
                  <td className="py-1 text-right">
                    <MoneyAmount value={due.settledAmount} />
                  </td>
                  <td className="py-1 text-right font-medium">
                    <MoneyAmount value={due.openAmount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {invoice.creditNotes.length > 0 && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="font-medium">{t('detail.creditNotes')}</h2>
          {invoice.creditNotes.map((note) => (
            <Link
              key={note.id}
              to={`/invoicing/invoices/${note.id}`}
              className="font-mono underline-offset-4 hover:underline"
            >
              {note.reference} · {formatDate(note.issueDate, language)} ·{' '}
              <MoneyAmount value={note.total} />
            </Link>
          ))}
        </section>
      )}

      {invoice.shipments.length > 0 && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="font-medium">{t('detail.shipments')}</h2>
          {invoice.shipments.map((shipment) => (
            <p key={shipment.fulfilmentId}>
              <span className="font-mono">{shipment.documentReference}</span> ·{' '}
              {formatDate(shipment.documentDate, language)} ·{' '}
              <Link
                to={`/orders/${shipment.orderId}`}
                className="font-mono underline-offset-4 hover:underline"
              >
                {shipment.orderReference}
              </Link>
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
