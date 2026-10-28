import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { DataTable } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useMe } from '@/lib/auth/me';
import { useAuditEvents } from './queries';
import { formatTime } from '@/lib/format';

const TYPES = [
  'TENANT_SELECTED',
  'TENANT_CREATED',
  'MEMBER_ADDED',
  'MEMBER_REMOVED',
  'MODULES_CHANGED',
  'COMPANY_ADDED',
  'PARTY_CREATED',
  'PARTY_UPDATED',
  'PARTY_ARCHIVED',
  'PARTY_RESTORED',
  'ITEM_CREATED',
  'ITEM_UPDATED',
  'ITEM_ARCHIVED',
  'ITEM_RESTORED',
  'WAREHOUSE_CREATED',
  'WAREHOUSE_UPDATED',
  'WAREHOUSE_ARCHIVED',
  'WAREHOUSE_RESTORED',
  'STOCK_DOCUMENT_POSTED',
  'STOCK_DOCUMENT_REVERSED',
  'REORDER_LEVEL_SET',
  'REORDER_LEVEL_REMOVED',
  'ORDER_CREATED',
  'ORDER_UPDATED',
  'ORDER_DELETED',
  'ORDER_CONFIRMED',
  'ORDER_RESERVED',
  'ORDER_CLOSED',
  'ORDER_CANCELLED',
  'ORDER_FULFILLED',
  'ORDER_FULFILMENT_REVERSED',
] as const;

/** Records an event can be about, and where they open. */
const SUBJECT_PATHS: Record<string, string> = {
  party: '/parties',
  item: '/items',
  stock_document: '/stock/documents',
  order: '/orders',
};

/** The audit log of the current customer, for administrators (permission audit:read). */
export function ActivityPage() {
  const { t, i18n } = useTranslation('activity');
  const me = useMe().data;
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const events = useAuditEvents({ page, type: type || undefined });

  if (me && !me.permissions.includes('audit:read')) return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="event-type" className="text-muted-foreground">
          {t('filterType')}
        </label>
        <NativeSelect
          id="event-type"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
        >
          <NativeSelectOption value="">{t('allTypes')}</NativeSelectOption>
          {TYPES.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {t(`type.${value}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <DataTable
        rows={events.data?.items}
        rowKey={(row) => row.id}
        isLoading={events.isPending}
        error={events.error}
        emptyTitle={t('empty')}
        page={events.data?.page ?? page}
        pageSize={events.data?.pageSize ?? 25}
        total={events.data?.total ?? 0}
        onPageChange={setPage}
        columns={[
          {
            key: 'at',
            header: t('when'),
            card: 'subtitle',
            cell: (row) => formatTime(row.at, i18n.language),
          },
          {
            key: 'type',
            header: t('what'),
            card: 'title',
            cell: (row) =>
              (TYPES as readonly string[]).includes(row.type)
                ? t(`type.${row.type as (typeof TYPES)[number]}`)
                : row.type,
          },
          {
            key: 'who',
            header: t('who'),
            card: 'subtitle',
            cell: (row) => row.actor?.name ?? t('terminal'),
          },
          {
            key: 'subject',
            header: t('subject'),
            card: 'detail',
            cell: (row) => {
              const path = row.subjectId && SUBJECT_PATHS[row.subjectType ?? ''];
              const details = row.details as { fields?: unknown; reference?: unknown } | null;
              const fields = details?.fields;
              // A stock document is named by its number, as people know it.
              const name =
                typeof details?.reference === 'string'
                  ? details.reference
                  : t(`subjectType.${row.subjectType as 'party'}`);
              return (
                <span className="flex flex-col">
                  {path ? (
                    <Link
                      className="underline-offset-4 hover:underline"
                      to={`${path}/${row.subjectId}`}
                    >
                      {name}
                    </Link>
                  ) : (
                    row.subjectType && <span>{name}</span>
                  )}
                  {Array.isArray(fields) && (
                    <span className="text-muted-foreground text-xs">
                      {t('fields', { fields: fields.join(', ') })}
                    </span>
                  )}
                </span>
              );
            },
          },
        ]}
      />
    </div>
  );
}
