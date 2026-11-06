import { ArchiveIcon, CopyIcon, LockIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/lib/auth/me';
import type { BuiltinRole } from '@/lib/auth/role';
import { RoleEditor, type RoleDraft } from './RoleEditor';
import { type CustomRole, useArchiveRole, useRoles } from './queries';

/**
 * `/roles`: built-in roles, read only, and the roles the tenant defines (docs/adr/0036). A
 * built-in role is never changed: it is duplicated, and the copy belongs to the tenant.
 */
export function RolesPage() {
  const { t } = useTranslation('members');
  const { t: tAuth } = useTranslation('auth');
  const me = useMe().data;
  const canManage = Boolean(me?.permissions.includes('roles:manage'));
  const roles = useRoles();
  const [open, setOpen] = useState<RoleDraft | null>(null);
  const [archiving, setArchiving] = useState<CustomRole | null>(null);
  const archive = useArchiveRole();

  if (me && !me.permissions.includes('members:read')) return <Navigate to="/" replace />;

  const duplicate = (key: BuiltinRole, permissions: string[]): RoleDraft => ({
    mode: 'new',
    name: t('roles.copyOf', { name: tAuth(`roles.${key}`) }),
    description: '',
    // A copy of a built-in role cannot keep what only the administrator may do.
    permissions: permissions.filter((p) => p !== 'members:manage' && p !== 'roles:manage'),
    basedOn: key,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('roles.title')}
        description={t('roles.description')}
        actions={
          canManage &&
          open === null && (
            <Button
              onClick={() =>
                setOpen({ mode: 'new', name: '', description: '', permissions: [], basedOn: null })
              }
            >
              <PlusIcon data-icon="inline-start" />
              {t('roles.new')}
            </Button>
          )
        }
      />
      {open && (
        <RoleEditor
          key={open.mode === 'edit' ? open.role.id : open.mode === 'view' ? open.key : 'new'}
          draft={open}
          canManage={canManage}
          onDuplicate={(key, permissions) => setOpen(duplicate(key, permissions))}
          onDone={() => setOpen(null)}
        />
      )}
      <ErrorMessage error={roles.error ?? archive.error} />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t('roles.builtinTitle')}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {roles.data?.builtin.map((role) => (
            <Card key={role.key} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LockIcon aria-hidden className="text-muted-foreground size-4" />
                  {tAuth(`roles.${role.key}`)}
                </CardTitle>
                <CardDescription>
                  {t('roles.permissions', { count: role.permissions.length })} ·{' '}
                  {t('roles.members', { count: role.members })}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setOpen({ mode: 'view', key: role.key, permissions: role.permissions })
                  }
                >
                  {t('roles.view')}
                </Button>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpen(duplicate(role.key, role.permissions))}
                  >
                    <CopyIcon data-icon="inline-start" />
                    {t('roles.duplicate')}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t('roles.customTitle')}</h2>
        {roles.data && roles.data.custom.length === 0 && (
          <p className="text-muted-foreground text-sm">{t('roles.empty')}</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {roles.data?.custom.map((role) => (
            <Card key={role.id} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {role.name}
                  {role.basedOn && (
                    <Badge variant="secondary">{tAuth(`roles.${role.basedOn}`)}</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {role.description && <span className="block">{role.description}</span>}
                  {t('roles.permissions', { count: role.permissions.length })} ·{' '}
                  {t('roles.members', { count: role.members })}
                </CardDescription>
              </CardHeader>
              {canManage && (
                <CardContent className="flex flex-wrap items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setOpen({ mode: 'edit', role })}>
                    <PencilIcon data-icon="inline-start" />
                    {t('roles.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={role.members > 0}
                    onClick={() => {
                      archive.reset();
                      setArchiving(role);
                    }}
                  >
                    <ArchiveIcon data-icon="inline-start" />
                    {t('roles.archive')}
                  </Button>
                  {role.members > 0 && (
                    <span className="text-muted-foreground text-xs">
                      {t('roles.inUse', { count: role.members })}
                    </span>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </section>
      <ConfirmDialog
        open={archiving !== null}
        title={t('roles.archiveTitle', { name: archiving?.name ?? '' })}
        description={t('roles.archiveDescription')}
        confirmLabel={t('roles.archive')}
        destructive
        pending={archive.isPending}
        onCancel={() => setArchiving(null)}
        onConfirm={() =>
          archiving &&
          archive.mutate(
            { id: archiving.id, version: archiving.version },
            { onSettled: () => setArchiving(null) },
          )
        }
      />
    </div>
  );
}
