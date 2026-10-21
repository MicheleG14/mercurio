import type { useBlocker } from 'react-router';
import { useTranslation } from 'react-i18next';
import { unsavedChanges, useLeaveRequested } from '@/lib/unsaved-changes';
import { ConfirmDialog } from './ConfirmDialog';

/** The question itself, for a form that uses useUnsavedChanges. */
export function UnsavedChangesDialog({ blocker }: { blocker: ReturnType<typeof useBlocker> }) {
  const { t } = useTranslation();
  const leaveRequested = useLeaveRequested();
  const open = blocker.state === 'blocked' || leaveRequested;

  return (
    <ConfirmDialog
      open={open}
      title={t('unsaved.title')}
      description={t('unsaved.description')}
      confirmLabel={t('unsaved.discard')}
      destructive
      onConfirm={() => {
        if (blocker.state === 'blocked') blocker.proceed();
        else unsavedChanges.confirm();
      }}
      onCancel={() => {
        if (blocker.state === 'blocked') blocker.reset();
        else unsavedChanges.cancel();
      }}
    />
  );
}
