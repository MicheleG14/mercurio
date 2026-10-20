import { zodResolver } from '@hookform/resolvers/zod';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';
import { z } from 'zod';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RecoveryCodes } from './RecoveryCodes';
import { sixDigits } from './forms';
import { useEnrollConfirm, useEnrollStart } from './queries';
import { sessionStore } from '@/lib/auth/session';

type Confirmed = Awaited<ReturnType<ReturnType<typeof useEnrollConfirm>['mutateAsync']>>;

/**
 * Two-factor setup: show the secret as a QR code, check a code from the app, then show the
 * recovery codes. The session starts only when the person leaves the last screen, so the
 * route guard does not move them away before they have saved the codes.
 */
export function EnrollPage() {
  const { t } = useTranslation('auth');
  const { t: tError } = useTranslation('errors');
  const token = (useLocation().state as { token?: string } | null)?.token;
  const start = useEnrollStart();
  const confirm = useEnrollConfirm();
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const requested = useRef(false);
  const form = useForm<{ code: string }>({
    resolver: zodResolver(z.object({ code: sixDigits })),
    defaultValues: { code: '' },
  });

  useEffect(() => {
    // Asking twice would replace the secret the person is already scanning.
    if (!token || requested.current) return;
    requested.current = true;
    start.mutate({ enrollToken: token });
  }, [token, start]);

  if (!token) return <Navigate to="/login" replace />;

  if (confirmed) {
    return (
      <RecoveryCodes
        codes={confirmed.recoveryCodes}
        onDone={() =>
          sessionStore.signIn({
            accessToken: confirmed.accessToken,
            tenantId: confirmed.tenantId,
            tenants: confirmed.tenants,
          })
        }
      />
    );
  }

  const message = form.formState.errors.code?.message;
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg font-semibold">{t('enroll.title')}</h1>
        </CardTitle>
        <CardDescription>{t('enroll.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ErrorMessage error={start.error ?? confirm.error} />
        {start.data && (
          <div className="flex flex-col items-center gap-3">
            {/* The QR code is drawn in the browser: the secret never goes to an image service. */}
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={start.data.uri} size={176} title={t('enroll.qrLabel')} />
            </div>
            <p className="text-muted-foreground text-center text-sm">{t('enroll.manual')}</p>
            <code className="bg-muted rounded px-2 py-1 font-mono text-sm break-all">
              {start.data.secret}
            </code>
          </div>
        )}
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit(({ code }) =>
            confirm.mutate({ enrollToken: token, code }, { onSuccess: setConfirmed }),
          )}
        >
          <FormField
            label={t('enroll.code')}
            error={message ? tError(message as never) : undefined}
          >
            {(props) => (
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                {...props}
                {...form.register('code')}
              />
            )}
          </FormField>
          <Button type="submit" disabled={confirm.isPending || !start.data}>
            {t('enroll.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
