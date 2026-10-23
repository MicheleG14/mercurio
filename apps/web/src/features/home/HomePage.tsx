import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/lib/auth/me';
import { useStockSummary } from './queries';

/** The landing page after signing in. Module features join it in the next phases. */
export function HomePage() {
  const { t } = useTranslation('home');
  const { t: tAuth } = useTranslation('auth');
  const me = useMe().data;
  const warehouse =
    Boolean(me?.modules.includes('warehouse')) && Boolean(me?.permissions.includes('stock:read'));
  const stock = useStockSummary(warehouse);
  if (!me?.tenant) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('welcome', { name: me.user.name })}
        description={t('description', { tenant: me.tenant.name })}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('role')}</CardTitle>
          </CardHeader>
          <CardContent>{tAuth(`roles.${me.role as 'ADMIN'}`)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('modules')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {me.modules.length === 0 && (
              <span className="text-muted-foreground">{t('noModules')}</span>
            )}
            {me.modules.map((key) => (
              <Badge key={key} variant="secondary">
                {t(`module.${key as 'registry'}`)}
              </Badge>
            ))}
          </CardContent>
        </Card>
        {warehouse && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>{t('warehouse.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end justify-between gap-4">
              <dl className="flex gap-8">
                <div>
                  <dt className="text-muted-foreground text-sm">{t('warehouse.belowReorder')}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    <Link to="/stock/below-reorder" className="underline-offset-4 hover:underline">
                      {stock.data?.belowReorder ?? '–'}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-sm">{t('warehouse.documentsToday')}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    {stock.data?.documentsToday ?? '–'}
                  </dd>
                </div>
              </dl>
              <Link to="/stock" className={buttonVariants({ variant: 'outline' })}>
                {t('warehouse.open')}
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
      <p className="text-muted-foreground text-sm">{t('comingSoon')}</p>
    </div>
  );
}
