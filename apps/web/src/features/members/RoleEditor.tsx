import { CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import type { BuiltinRole } from '@/lib/auth/role';
import { cn } from '@/lib/utils';
import { groupOf, PERMISSION_GROUPS, requiredBy, togglePermission } from './permissions';
import { type CustomRole, type RoleBody, usePermissionCatalog, useSaveRole } from './queries';

export type RoleDraft =
  | { mode: 'view'; key: BuiltinRole; permissions: string[] }
  | {
      mode: 'new';
      name: string;
      description: string;
      permissions: string[];
      basedOn: BuiltinRole | null;
    }
  | { mode: 'edit'; role: CustomRole };

interface RoleEditorProps {
  draft: RoleDraft;
  canManage: boolean;
  onDuplicate: (key: BuiltinRole, permissions: string[]) => void;
  onDone: () => void;
}

/**
 * A role and its permissions, grouped by module in the order work flows. Built-in roles are shown
 * read only; a custom role keeps itself consistent while ticking (see permissions.ts).
 */
export function RoleEditor({ draft, canManage, onDuplicate, onDone }: RoleEditorProps) {
  const { t } = useTranslation('members');
  const { t: tc } = useTranslation();
  const { t: tAuth } = useTranslation('auth');
  const { t: tError } = useTranslation('errors');
  const catalog = usePermissionCatalog().data?.permissions ?? [];
  const save = useSaveRole();
  const readOnly = draft.mode === 'view' || !canManage;

  const initial =
    draft.mode === 'edit'
      ? {
          name: draft.role.name,
          description: draft.role.description ?? '',
          permissions: draft.role.permissions,
        }
      : draft.mode === 'new'
        ? draft
        : { name: tAuth(`roles.${draft.key}`), description: '', permissions: draft.permissions };
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [permissions, setPermissions] = useState<string[]>(initial.permissions);

  const fieldError = (field: string) => {
    const error =
      save.error instanceof ApiError
        ? save.error.problem?.errors?.find((e) => e.field === field)
        : undefined;
    return error ? tError(`validation.${error.code}` as never) : undefined;
  };
  const fieldsExplained =
    save.error instanceof ApiError && Boolean(save.error.problem?.errors?.length);
  // "parties:read" → roles.permission.parties.read: a colon would be read as a namespace.
  const label = (key: string) => t(`roles.permission.${key.replace(':', '.')}` as never);

  const title =
    draft.mode === 'new'
      ? t('roles.newTitle')
      : t('roles.editTitle', {
          name: draft.mode === 'edit' ? draft.role.name : tAuth(`roles.${draft.key}`),
        });

  return (
    <form
      noValidate
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (readOnly) return;
        save.mutate(
          {
            id: draft.mode === 'edit' ? draft.role.id : undefined,
            version: draft.mode === 'edit' ? draft.role.version : undefined,
            name,
            description: description || null,
            permissions: permissions as RoleBody['permissions'],
            basedOn: draft.mode === 'new' ? (draft.basedOn ?? undefined) : undefined,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <h2 className="text-sm font-medium">{title}</h2>
      {draft.mode === 'view' ? (
        <p className="text-muted-foreground text-sm">{t('roles.builtinReadonly')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('roles.name')} error={fieldError('name')}>
            {(p) => (
              <Input
                {...p}
                maxLength={60}
                readOnly={readOnly}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={t('roles.roleDescription')} error={fieldError('description')}>
            {(p) => (
              <Textarea
                {...p}
                rows={1}
                maxLength={200}
                readOnly={readOnly}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </FormField>
        </div>
      )}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-medium">{t('roles.permissions')}</legend>
        {fieldError('permissions') && (
          <p className="text-destructive text-sm">{fieldError('permissions')}</p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {PERMISSION_GROUPS.map((group) => {
            const items = catalog.filter((p) => groupOf(p) === group);
            if (items.length === 0) return null;
            const off = items.every((p) => !p.moduleEnabled);
            return (
              <div key={group} className="flex flex-col gap-2">
                <h3 className={cn('text-sm font-medium', off && 'text-muted-foreground')}>
                  {t(`roles.groups.${group}`)}
                </h3>
                {off && <p className="text-muted-foreground text-xs">{t('roles.moduleOff')}</p>}
                {items.map((p) => {
                  const checked = permissions.includes(p.key);
                  // Reserved permissions stay with the built-in administrator (docs/adr/0036).
                  const locked = readOnly || p.reserved;
                  const needed = requiredBy(catalog, permissions, p.key);
                  return (
                    <label
                      key={p.key}
                      className={cn(
                        'flex items-start gap-2 text-sm',
                        (!p.moduleEnabled || locked) && 'text-muted-foreground',
                      )}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        disabled={locked}
                        onCheckedChange={(on) =>
                          setPermissions((current) =>
                            togglePermission(catalog, current, p.key, Boolean(on)),
                          )
                        }
                      />
                      <span className="flex flex-col">
                        <span>{label(p.key)}</span>
                        {p.reserved && draft.mode !== 'view' && (
                          <span className="text-xs">{t('roles.reserved')}</span>
                        )}
                        {!readOnly && checked && needed.length > 0 && (
                          <span className="text-muted-foreground text-xs">
                            {t('roles.requiredBy', { list: needed.map(label).join(', ') })}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </fieldset>
      {draft.mode !== 'view' && (
        <p className="text-muted-foreground text-xs">{t('roles.futureNote')}</p>
      )}
      {!fieldsExplained && <ErrorMessage error={save.error} />}
      <div className="flex flex-wrap justify-end gap-2">
        {draft.mode === 'view' ? (
          <>
            <Button type="button" variant="outline" onClick={onDone}>
              {t('roles.close')}
            </Button>
            {canManage && (
              <Button type="button" onClick={() => onDuplicate(draft.key, draft.permissions)}>
                <CopyIcon data-icon="inline-start" />
                {t('roles.duplicate')}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onDone}>
              {tc('actions.cancel')}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={save.isPending}>
                {tc('actions.save')}
              </Button>
            )}
          </>
        )}
      </div>
    </form>
  );
}
