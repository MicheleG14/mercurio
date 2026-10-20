import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSelectTenant } from './queries';
import { useSession } from '@/lib/auth/session';

/** Shown when the person belongs to several customers (tenants) and has not chosen one. */
export function SelectTenantPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const session = useSession();
  const select = useSelectTenant();

  if (session.status === 'anonymous') return <Navigate to="/login" replace />;

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg font-semibold">{t('tenant.title')}</h1>
        </CardTitle>
        <CardDescription>{t('tenant.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ErrorMessage error={select.error} />
        <ul className="flex flex-col gap-2">
          {session.tenants.map((tenant) => (
            <li
              key={tenant.id}
              className="ring-foreground/10 flex items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1"
            >
              <div className="flex flex-col">
                <span className="font-medium">{tenant.name}</span>
                <span className="text-muted-foreground text-xs">
                  {t('tenant.role')}: {t(`roles.${tenant.role}`)}
                </span>
              </div>
              <Button
                size="sm"
                variant={tenant.id === session.tenantId ? 'secondary' : 'default'}
                disabled={select.isPending}
                onClick={() => select.mutate(tenant.id, { onSuccess: () => navigate('/') })}
              >
                {t('tenant.choose')}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
