import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/auth/me';
import type { BuiltinRole } from '@/lib/auth/role';
import {
  type AddedMember,
  type Member,
  type RoleChoice,
  useAddMember,
  useRoles,
  useUpdateMember,
} from './queries';

/** A role in the select: "builtin:ACCOUNTANT" or "custom:<id>". */
const encode = (role: Member['role']) =>
  role.kind === 'builtin' ? `builtin:${role.key}` : `custom:${role.id}`;
const decode = (value: string): RoleChoice => {
  const [kind, rest] = value.split(':') as [string, string];
  return kind === 'builtin' ? { builtin: rest as BuiltinRole } : { customRoleId: rest };
};

interface MemberFormProps {
  /** Null to add a person; a member to change role and companies. */
  member: Member | null;
  onCancel: () => void;
  onAdded: (added: AddedMember, name: string) => void;
  onSaved: () => void;
}

/**
 * Adding a person (email, name, role, companies) or changing the role and companies of one. Name
 * and email are the person's own and never change here: they may work for other customers too.
 */
export function MemberForm({ member, onCancel, onAdded, onSaved }: MemberFormProps) {
  const { t } = useTranslation('members');
  const { t: tc } = useTranslation();
  const { t: tAuth } = useTranslation('auth');
  const { t: tError } = useTranslation('errors');
  const me = useMe().data;
  const roles = useRoles().data;
  const add = useAddMember();
  const update = useUpdateMember();
  const save = member ? update : add;

  const companies = me?.companies ?? [];
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState(member ? encode(member.role) : 'builtin:READ_ONLY');
  const [allCompanies, setAllCompanies] = useState(member?.allCompanies ?? true);
  const [companyIds, setCompanyIds] = useState<string[]>(member?.companyIds ?? []);

  const fieldError = (...fields: string[]) => {
    const error =
      save.error instanceof ApiError
        ? save.error.problem?.errors?.find((e) => fields.includes(e.field))
        : undefined;
    return error ? tError(`validation.${error.code}` as never) : undefined;
  };
  const fieldsExplained =
    save.error instanceof ApiError && Boolean(save.error.problem?.errors?.length);

  const submit = () => {
    const choice = { role: decode(role), allCompanies, companyIds: allCompanies ? [] : companyIds };
    if (member) {
      update.mutate({ id: member.id, version: member.version, ...choice }, { onSuccess: onSaved });
    } else {
      add.mutate(
        { email, name, ...choice },
        { onSuccess: (added) => onAdded(added, added.member.name) },
      );
    }
  };

  return (
    <form
      noValidate
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className="text-sm font-medium">
        {member ? t('members.form.editTitle', { name: member.name }) : t('members.form.newTitle')}
      </h2>
      {!member && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('members.form.email')} error={fieldError('email')}>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </FormField>
          <FormField
            label={t('members.form.name')}
            hint={t('members.form.nameHint')}
            error={fieldError('name')}
          >
            {(p) => (
              <Input
                {...p}
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>
        </div>
      )}
      <FormField label={t('members.form.role')} error={fieldError('role')}>
        {(p) => (
          <NativeSelect {...p} value={role} onChange={(event) => setRole(event.target.value)}>
            <NativeSelectOptGroup label={t('members.form.builtinGroup')}>
              {(roles?.builtin ?? []).map((r) => (
                <NativeSelectOption key={r.key} value={`builtin:${r.key}`}>
                  {tAuth(`roles.${r.key}`)}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
            {Boolean(roles?.custom.length) && (
              <NativeSelectOptGroup label={t('members.form.customGroup')}>
                {roles!.custom.map((r) => (
                  <NativeSelectOption key={r.id} value={`custom:${r.id}`}>
                    {r.name}
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
            )}
          </NativeSelect>
        )}
      </FormField>
      {/* With a single company there is nothing to choose: every company, now and later. */}
      {companies.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('members.form.companies')}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="companies"
              checked={allCompanies}
              onChange={() => setAllCompanies(true)}
            />
            {t('members.form.allCompanies')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="companies"
              checked={!allCompanies}
              onChange={() => setAllCompanies(false)}
            />
            {t('members.form.someCompanies')}
          </label>
          {!allCompanies && (
            <div className="flex flex-col gap-2 pl-6">
              {companies.map((company) => (
                <label key={company.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={companyIds.includes(company.id)}
                    onCheckedChange={(checked) =>
                      setCompanyIds((ids) =>
                        checked ? [...ids, company.id] : ids.filter((id) => id !== company.id),
                      )
                    }
                  />
                  {company.legalName}
                </label>
              ))}
            </div>
          )}
          {fieldError('companies', 'companyIds') && (
            <p className="text-destructive text-sm">{fieldError('companies', 'companyIds')}</p>
          )}
        </fieldset>
      )}
      {!fieldsExplained && <ErrorMessage error={save.error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {member ? tc('actions.save') : t('members.add')}
        </Button>
      </div>
    </form>
  );
}
