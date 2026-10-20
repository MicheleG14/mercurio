import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { FormField } from '@/components/shared/FormField';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { emailField, requiredText } from './forms';
import { useLogin } from './queries';

const schema = z.object({ email: emailField, password: requiredText });
type Values = z.infer<typeof schema>;

/** First step of signing in. The answer decides the next screen: code, or unfinished setup. */
export function LoginPage() {
  const { t } = useTranslation('auth');
  const { t: tError } = useTranslation('errors');
  const navigate = useNavigate();
  const login = useLogin();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });
  const msg = (key?: string) => (key ? tError(key as never) : undefined);

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: (result) =>
        navigate(result.status === 'MFA_REQUIRED' ? '/login/mfa' : '/activate/enroll', {
          state: { token: result.token },
        }),
    }),
  );

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg font-semibold">{t('login.title')}</h1>
        </CardTitle>
        <CardDescription>{t('login.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <ErrorMessage error={login.error} />
          <FormField label={t('login.email')} error={msg(form.formState.errors.email?.message)}>
            {(props) => (
              <Input
                type="email"
                autoComplete="username"
                autoFocus
                {...props}
                {...form.register('email')}
              />
            )}
          </FormField>
          <FormField
            label={t('login.password')}
            error={msg(form.formState.errors.password?.message)}
          >
            {(props) => (
              <Input
                type="password"
                autoComplete="current-password"
                {...props}
                {...form.register('password')}
              />
            )}
          </FormField>
          <Button type="submit" disabled={login.isPending}>
            {t('login.submit')}
          </Button>
          <p className="text-muted-foreground text-sm">
            {t('login.activateHint')}{' '}
            <Link className="text-foreground underline underline-offset-4" to="/activate">
              {t('login.activateLink')}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
