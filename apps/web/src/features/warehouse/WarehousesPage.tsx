import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable } from '@/components/shared/DataTable';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useWarehouseRights } from './hooks';
import { useArchiveWarehouse, useSaveWarehouse, useWarehouses, type Warehouse } from './queries';

/** `/warehouses`: the warehouses of the company, for administrators (warehouses:manage). */
export function WarehousesPage() {
  const { t } = useTranslation('warehouse');
  const { t: tc } = useTranslation();
  const { manage } = useWarehouseRights();
  const [archived, setArchived] = useState(false);
  const warehouses = useWarehouses({ archived });
  // null: closed; 'new': creating; a warehouse: renaming it.
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Warehouse | null>(null);
  const archive = useArchiveWarehouse();

  if (!manage) return <Navigate to="/stock" replace />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('warehouses.title')}
        description={t('warehouses.description')}
        actions={
          editing === null && (
            <Button onClick={() => setEditing('new')}>
              <PlusIcon data-icon="inline-start" />
              {t('warehouses.new')}
            </Button>
          )
        }
      />
      {editing !== null && (
        <WarehouseForm
          key={editing === 'new' ? 'new' : editing.id}
          warehouse={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
      <label className="flex items-center gap-2 self-start text-sm">
        <Checkbox checked={archived} onCheckedChange={(checked) => setArchived(Boolean(checked))} />
        {t('warehouses.showArchived')}
      </label>
      <ErrorMessage error={archive.error} />
      <DataTable
        rows={warehouses.data?.items}
        rowKey={(row) => row.id}
        isLoading={warehouses.isPending}
        error={warehouses.error}
        emptyTitle={t('warehouses.empty')}
        page={1}
        pageSize={100}
        total={warehouses.data?.total ?? 0}
        onPageChange={() => {}}
        columns={[
          {
            key: 'code',
            header: t('warehouses.columns.code'),
            card: 'title',
            cell: (row) => (
              <span className="flex items-center gap-2">
                <span className="font-mono font-medium">{row.code}</span>
                {row.archivedAt && <Badge variant="warning">{t('warehouses.archived')}</Badge>}
              </span>
            ),
          },
          {
            key: 'name',
            header: t('warehouses.columns.name'),
            card: 'subtitle',
            cell: (row) => row.name,
          },
          {
            key: 'actions',
            header: '',
            card: 'detail',
            className: 'text-right',
            cell: (row) => (
              <span className="relative z-10 inline-flex gap-1">
                {!row.archivedAt && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                    <PencilIcon data-icon="inline-start" />
                    {t('warehouses.rename')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    archive.reset();
                    setArchiving(row);
                  }}
                >
                  {row.archivedAt ? (
                    <ArchiveRestoreIcon data-icon="inline-start" />
                  ) : (
                    <ArchiveIcon data-icon="inline-start" />
                  )}
                  {tc(row.archivedAt ? 'actions.restore' : 'actions.archive')}
                </Button>
              </span>
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={archiving !== null}
        title={t(archiving?.archivedAt ? 'warehouses.restoreTitle' : 'warehouses.archiveTitle', {
          name: archiving?.name ?? '',
        })}
        description={t(
          archiving?.archivedAt ? 'warehouses.restoreDescription' : 'warehouses.archiveDescription',
        )}
        confirmLabel={tc(archiving?.archivedAt ? 'actions.restore' : 'actions.archive')}
        destructive={!archiving?.archivedAt}
        pending={archive.isPending}
        onCancel={() => setArchiving(null)}
        onConfirm={() =>
          archiving &&
          archive.mutate(
            { id: archiving.id, archive: !archiving.archivedAt, version: archiving.version },
            { onSettled: () => setArchiving(null) },
          )
        }
      />
    </div>
  );
}

/** Creating a warehouse (code and name) or renaming one (the code never changes). */
function WarehouseForm({ warehouse, onDone }: { warehouse: Warehouse | null; onDone: () => void }) {
  const { t } = useTranslation('warehouse');
  const { t: tc } = useTranslation();
  const { t: tError } = useTranslation('errors');
  const save = useSaveWarehouse();
  const [code, setCode] = useState(warehouse?.code ?? '');
  const [name, setName] = useState(warehouse?.name ?? '');
  const fieldError = (field: string) => {
    const error =
      save.error instanceof ApiError
        ? save.error.problem?.errors?.find((e) => e.field === field)
        : undefined;
    return error ? tError(`validation.${error.code}` as never) : undefined;
  };
  const fieldsExplained =
    save.error instanceof ApiError && Boolean(save.error.problem?.errors?.length);

  return (
    <form
      noValidate
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          { id: warehouse?.id, code, name, version: warehouse?.version },
          { onSuccess: onDone },
        );
      }}
    >
      <h2 className="text-sm font-medium">
        {warehouse
          ? t('warehouses.renameTitle', { code: warehouse.code })
          : t('warehouses.newTitle')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <FormField
          label={t('warehouses.fields.code')}
          hint={warehouse ? undefined : t('warehouses.hint.code')}
          error={fieldError('code')}
        >
          {(p) => (
            <Input
              {...p}
              className="font-mono uppercase"
              autoComplete="off"
              maxLength={10}
              readOnly={Boolean(warehouse)}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('warehouses.fields.name')} error={fieldError('name')}>
          {(p) => <Input {...p} value={name} onChange={(event) => setName(event.target.value)} />}
        </FormField>
      </div>
      {!fieldsExplained && <ErrorMessage error={save.error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {tc('actions.save')}
        </Button>
      </div>
    </form>
  );
}
