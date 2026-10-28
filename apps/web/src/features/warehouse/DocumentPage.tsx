import { RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { PageHeader } from '@/components/shared/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { formatDate } from '@/lib/format';
import { useQuantity, useWarehouseRights } from './hooks';
import { type StockDocument, useReverseDocument, useStockDocument } from './queries';

/** `/stock/documents/:id`: a recorded document, read only; it can be reversed once. */
export function DocumentPage() {
  const { id = '' } = useParams();
  const document = useStockDocument(id);
  if (document.isPending) return <Skeleton className="h-64 w-full" />;
  if (document.error) return <ErrorMessage error={document.error} />;
  return <DocumentView document={document.data} />;
}

function DocumentView({ document }: { document: StockDocument }) {
  const { t, i18n } = useTranslation('warehouse');
  const quantity = useQuantity();
  const navigate = useNavigate();
  const { write } = useWarehouseRights();
  const reverse = useReverseDocument(document.id);
  const [asking, setAsking] = useState(false);
  const date = (value: string) => formatDate(value, i18n.language);
  // A document made by an order is undone from the order, which then knows (B35).
  const canReverse =
    write && document.reason !== 'REVERSAL' && !document.reversedBy && !document.origin;
  const signed = document.type === 'adjustment';

  const details: [string, React.ReactNode][] = [
    [t('document.fields.date'), date(document.documentDate)],
    [
      t(document.targetWarehouseCode ? 'document.fields.source' : 'document.fields.warehouse'),
      <span key="warehouse" className="font-mono">
        {document.warehouseCode}
      </span>,
    ],
    ...(document.targetWarehouseCode
      ? [
          [
            t('document.fields.target'),
            <span key="target" className="font-mono">
              {document.targetWarehouseCode}
            </span>,
          ] as [string, React.ReactNode],
        ]
      : []),
    ...(document.partyName
      ? [[t('document.fields.party'), document.partyName] as [string, React.ReactNode]]
      : []),
    ...(document.partyDocumentRef
      ? [
          [
            t('document.fields.partyDocumentRef'),
            document.partyDocumentDate
              ? `${document.partyDocumentRef} · ${date(document.partyDocumentDate)}`
              : document.partyDocumentRef,
          ] as [string, React.ReactNode],
        ]
      : []),
    ...(document.reversedReason
      ? [
          [t('document.reversedReason'), t(`reason.${document.reversedReason as 'OPENING'}`)] as [
            string,
            React.ReactNode,
          ],
        ]
      : []),
    [t('document.fields.createdBy'), document.createdByName ?? '—'],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('document.title', { reference: document.reference })}
        description={t(`reason.${document.reason as 'OPENING'}`)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t(`type.${document.type}`)}</Badge>
            {document.reversedBy && <Badge variant="warning">{t('documents.reversed')}</Badge>}
            {canReverse && (
              <Button variant="outline" onClick={() => setAsking(true)}>
                <RotateCcwIcon data-icon="inline-start" />
                {t('document.reverse.action')}
              </Button>
            )}
          </div>
        }
      />
      <ErrorMessage error={reverse.error} />
      {document.reversedBy && (
        <Alert variant="warning">
          <Link
            className="underline underline-offset-4"
            to={`/stock/documents/${document.reversedBy.id}`}
          >
            {t('document.reversedBy', { reference: document.reversedBy.reference })}
          </Link>
        </Alert>
      )}
      {document.origin && (
        <Alert>
          {document.origin.type === 'order' ? (
            <Link className="underline underline-offset-4" to={`/orders/${document.origin.id}`}>
              {t('document.origin', { reference: document.origin.reference })}
            </Link>
          ) : (
            t('document.origin', { reference: document.origin.reference })
          )}
        </Alert>
      )}
      {document.reverses && (
        <Alert>
          <Link
            className="underline underline-offset-4"
            to={`/stock/documents/${document.reverses.id}`}
          >
            {t('document.reverses', { reference: document.reverses.reference })}
          </Link>
        </Alert>
      )}

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {details.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      {document.notes && (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">{t('document.fields.notes')}</span>
          <p className="text-sm whitespace-pre-line">{document.notes}</p>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t('document.section.lines')}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>{t('document.lines.item')}</TableHead>
              {document.lines.some((l) => l.countedQuantity !== null) && (
                <TableHead className="text-right">{t('document.lines.counted')}</TableHead>
              )}
              <TableHead className="text-right">
                {t(signed ? 'document.lines.difference' : 'document.lines.quantity')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {document.lines.map((line) => (
              <TableRow key={line.lineNo}>
                <TableCell className="text-muted-foreground tabular-nums">{line.lineNo}</TableCell>
                <TableCell className="whitespace-normal">
                  <Link
                    to={`/stock/items/${line.itemId}`}
                    className="font-mono underline-offset-4 hover:underline"
                  >
                    {line.itemCode}
                  </Link>{' '}
                  <span className="text-muted-foreground">{line.itemDescription}</span>
                </TableCell>
                {line.countedQuantity !== null && (
                  <TableCell className="text-right tabular-nums">
                    {quantity(line.countedQuantity)} {line.unit}
                  </TableCell>
                )}
                <TableCell className="text-right font-medium tabular-nums">
                  {signed && !line.quantity.startsWith('-') ? '+' : ''}
                  {quantity(line.quantity)} {line.unit}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <p className="text-muted-foreground text-xs">{t('document.immutable')}</p>

      <ConfirmDialog
        open={asking}
        title={t('document.reverse.title', { reference: document.reference })}
        description={t('document.reverse.description')}
        confirmLabel={t('document.reverse.confirm')}
        destructive
        pending={reverse.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={() =>
          reverse.mutate(undefined, {
            onSuccess: (reversal) => void navigate(`/stock/documents/${reversal.id}`),
            onSettled: () => setAsking(false),
          })
        }
      />
    </div>
  );
}
