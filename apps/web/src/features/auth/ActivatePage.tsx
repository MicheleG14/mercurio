import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { passwordField, passwordsMatch, requiredText, serverFieldErrors } from './forms';
import { useActivate } from './queries';

const schema = z
  .object({ code: requiredText, password: passwordField, confirm: z.string() })
  .refine((v) => v.password === v.confirm, passwordsMatch);
type Values = z.infer<typeof schema>;

/**
 * Redeems the activation code and sets the password. The code usually arrives in the address as
 * `#code`: a fragment is never sent to the server, so it stays out of access logs and of the
 * Referer header.
 */
export function ActivatePage() {
  const { t } = useTranslation('auth');
  const { t: tError } = useTranslation('errors');
  const navigate = useNavigate();
  const { hash } = useLocation();
  const activate = useActivate();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { code: decodeURIComponent(hash.replace(/^#/, '')), password: '', confirm: '' },
  });
  const errors = form.formState.errors;
  const msg = (key?: string) => (key ? tError(key as never) : undefined);

  const onSubmit = form.handleSubmit(({ code, password }) =>
    activate.mutate(
      { code, password },
      {
        onSuccess: ({ enrollToken }) =>
          navigate('/activate/enroll', { state: { token: enrollToken }, replace: true }),
        onError: (error) => serverFieldErrors(error, form.setError as never, ['password']),
      },
    ),
  );

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg font-semibold">{t('activate.title')}</h1>
        </CardTitle>
        <CardDescription>{t('activate.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {!errors.password && <ErrorMessage error={activate.error} />}
          <FormField
            label={t('activate.code')}
            hint={t('activate.codeHint')}
            error={msg(errors.code?.message)}
          >
            {(props) => (
              <Input autoComplete="off" spellCheck={false} {...props} {...form.register('code')} />
            )}
          </FormField>
          <FormField
            label={t('activate.password')}
            hint={t('activate.passwordHint')}
            error={msg(errors.password?.message)}
          >
            {(props) => (
              <Input
                type="password"
                autoComplete="new-password"
                {...props}
                {...form.register('password')}
              />
            )}
          </FormField>
          <FormField label={t('activate.confirm')} error={msg(errors.confirm?.message)}>
            {(props) => (
              <Input
                type="password"
                autoComplete="new-password"
                {...props}
                {...form.register('confirm')}
              />
            )}
          </FormField>
          <Button type="submit" disabled={activate.isPending}>
            {t('activate.submit')}
          </Button>
          <Link
            className="text-muted-foreground w-fit text-sm underline underline-offset-4"
            to="/login"
          >
            {t('activate.signIn')}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
