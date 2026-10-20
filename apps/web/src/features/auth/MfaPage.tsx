import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router';
import { z } from 'zod';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { requiredText, sixDigits } from './forms';
import { useVerifyMfa } from './queries';

/** Second step of signing in: the code of the app, or a recovery code. */
export function MfaPage() {
  const { t } = useTranslation('auth');
  const { t: tError } = useTranslation('errors');
  const location = useLocation();
  const token = (location.state as { token?: string } | null)?.token;
  const [useRecovery, setUseRecovery] = useState(false);
  const verify = useVerifyMfa();

  const schema = z.object({ code: useRecovery ? requiredText : sixDigits });
  const form = useForm<{ code: string }>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
  });

  // The challenge lives in the router state only: a reload loses it and starts over.
  if (!token) return <Navigate to="/login" replace />;

  const onSubmit = form.handleSubmit(({ code }) => verify.mutate({ challengeToken: token, code }));
  const message = form.formState.errors.code?.message;

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg font-semibold">{t('mfa.title')}</h1>
        </CardTitle>
        <CardDescription>{t('mfa.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <ErrorMessage error={verify.error} />
          <FormField
            label={useRecovery ? t('mfa.recoveryLabel') : t('mfa.code')}
            hint={useRecovery ? t('mfa.recoveryHint') : undefined}
            error={message ? tError(message as never) : undefined}
          >
            {(props) => (
              <Input
                key={useRecovery ? 'recovery' : 'totp'}
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoFocus
                {...props}
                {...form.register('code')}
              />
            )}
          </FormField>
          <Button type="submit" disabled={verify.isPending}>
            {t('mfa.submit')}
          </Button>
          <div className="flex flex-col gap-2 text-sm">
            <button
              type="button"
              className="text-foreground w-fit underline underline-offset-4"
              onClick={() => {
                setUseRecovery((v) => !v);
                form.reset({ code: '' });
                verify.reset();
              }}
            >
              {useRecovery ? t('mfa.useApp') : t('mfa.useRecovery')}
            </button>
            <Link
              className="text-muted-foreground w-fit underline underline-offset-4"
              to="/login"
              replace
            >
              {t('mfa.cancel')}
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
