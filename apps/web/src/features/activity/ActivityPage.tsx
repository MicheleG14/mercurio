import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { DataTable } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
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
] as const;

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
        <select
          id="event-type"
          className="border-input bg-background h-8 rounded-lg border px-2"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('allTypes')}</option>
          {TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`type.${value}`)}
            </option>
          ))}
        </select>
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
          { key: 'at', header: t('when'), cell: (row) => formatTime(row.at, i18n.language) },
          {
            key: 'type',
            header: t('what'),
            cell: (row) =>
              (TYPES as readonly string[]).includes(row.type)
                ? t(`type.${row.type as (typeof TYPES)[number]}`)
                : row.type,
          },
          { key: 'who', header: t('who'), cell: (row) => row.actor?.name ?? t('terminal') },
        ]}
      />
    </div>
  );
}
