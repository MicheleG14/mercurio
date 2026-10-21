import { ArchiveIcon, ArchiveRestoreIcon, RotateCcwIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';

// The pieces every registry record shares (party, item): the same notices, the same way of
// archiving, so the next modules can follow one pattern ("list and record", docs/architecture.md).

const isConflict = (error: unknown) =>
  error instanceof ApiError && error.problem?.code === 'EDIT_CONFLICT';

/** Messages above a record: archived, read only, someone else saved first, saved. */
export function RecordNotices({
  archived,
  readOnly,
  error,
  saved,
  onReload,
}: {
  archived: boolean;
  readOnly: boolean;
  /** The last failed save; field errors are shown on the fields, the rest here. */
  error: unknown;
  saved: boolean;
  onReload: () => void;
}) {
  const { t } = useTranslation('registry');
  const { t: tc } = useTranslation();
  const fieldErrorsOnly =
    error instanceof ApiError &&
    error.problem?.code === 'VALIDATION_FAILED' &&
    Boolean(error.problem.errors?.length);

  return (
    <>
      {isConflict(error) ? (
        <Alert variant="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('common.conflict')}</span>
          <Button size="sm" variant="outline" onClick={onReload}>
            <RotateCcwIcon data-icon="inline-start" />
            {tc('actions.reload')}
          </Button>
        </Alert>
      ) : (
        !fieldErrorsOnly && <ErrorMessage error={error} />
      )}
      {archived && <Alert variant="warning">{t('common.archivedNotice')}</Alert>}
      {readOnly && !archived && <Alert>{t('common.readOnly')}</Alert>}
      {saved && <Alert variant="success">{t('common.saved')}</Alert>}
    </>
  );
}

export function ArchivedBadge() {
  const { t } = useTranslation('registry');
  return <Badge variant="warning">{t('common.archived')}</Badge>;
}

/** Archive or restore, after a question that repeats the name. */
export function ArchiveButton({
  archived,
  name,
  pending,
  onConfirm,
}: {
  archived: boolean;
  name: string;
  pending: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const { t } = useTranslation('registry');
  const { t: tc } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={archived ? 'outline' : 'destructive'} onClick={() => setOpen(true)}>
        {archived ? (
          <ArchiveRestoreIcon data-icon="inline-start" />
        ) : (
          <ArchiveIcon data-icon="inline-start" />
        )}
        {tc(archived ? 'actions.restore' : 'actions.archive')}
      </Button>
      <ConfirmDialog
        open={open}
        title={t(archived ? 'common.restoreTitle' : 'common.archiveTitle', { name })}
        description={t(archived ? 'common.restoreDescription' : 'common.archiveDescription')}
        confirmLabel={tc(archived ? 'actions.restore' : 'actions.archive')}
        destructive={!archived}
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => void onConfirm().finally(() => setOpen(false))}
      />
    </>
  );
}

/** A titled group of fields in two columns (F8). */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-border grid gap-4 border-t pt-4 md:grid-cols-[12rem_1fr]">
      <legend className="sr-only">{title}</legend>
      <h2 aria-hidden="true" className="text-sm font-medium">
        {title}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
