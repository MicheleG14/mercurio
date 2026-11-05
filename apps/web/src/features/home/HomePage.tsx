import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/lib/auth/me';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { useInvoicingSummary, useOrdersSummary, useStockSummary } from './queries';

/** The modules a tenant can have, besides the registry that is always there. */
const OPTIONAL_MODULES = ['warehouse', 'orders', 'invoicing'] as const;

/** The charts and their library load after the counters (docs/adr/0032). */
const OverviewCharts = lazy(() => import('./OverviewCharts'));

/**
 * The landing page after signing in: a card per module the person can see, and the modules the
 * customer lacks with what they would add (a person working on a customer without a module
 * otherwise looks for its screens in vain).
 */
export function HomePage() {
  const { t } = useTranslation('home');
  const { t: tAuth } = useTranslation('auth');
  const me = useMe().data;
  const warehouse =
    Boolean(me?.modules.includes('warehouse')) && Boolean(me?.permissions.includes('stock:read'));
  const stock = useStockSummary(warehouse);
  const orders =
    Boolean(me?.modules.includes('orders')) && Boolean(me?.permissions.includes('orders:read'));
  const ordersSummary = useOrdersSummary(orders).data;
  const invoicing =
    Boolean(me?.modules.includes('invoicing')) &&
    Boolean(me?.permissions.includes('invoicing:read'));
  const invoicingSummary = useInvoicingSummary(invoicing).data;
  if (!me?.tenant) return null;
  const inactive = OPTIONAL_MODULES.filter((key) => !me.modules.includes(key));

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
        {orders && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>{t('orders.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {(
                  [
                    ['salesOpen', '/orders/sales?status=OPEN'],
                    ['salesUncovered', '/orders/sales?status=OPEN&uncovered=true'],
                    ['salesLate', '/orders/sales?status=OPEN&late=true'],
                    ['purchaseOpen', '/orders/purchase?status=OPEN'],
                    ['purchaseLate', '/orders/purchase?status=OPEN&late=true'],
                  ] as const
                ).map(([key, to]) => (
                  <div key={key}>
                    <dt className="text-muted-foreground text-sm">{t(`orders.${key}`)}</dt>
                    <dd className="text-2xl font-semibold tabular-nums">
                      <Link to={to} className="underline-offset-4 hover:underline">
                        {ordersSummary?.[key] ?? '–'}
                      </Link>
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}
        {invoicing && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>{t('invoicing.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end justify-between gap-4">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <div>
                  <dt className="text-muted-foreground text-sm">{t('invoicing.toInvoice')}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    <Link to="/invoicing/to-invoice" className="underline-offset-4 hover:underline">
                      {invoicingSummary?.toInvoice ?? '–'}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-sm">{t('invoicing.drafts')}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    <Link to="/invoicing/invoices" className="underline-offset-4 hover:underline">
                      {invoicingSummary?.drafts ?? '–'}
                    </Link>
                  </dd>
                </div>
                {(['overdue', 'dueSoon', 'invoicedThisMonth'] as const).map((key) => (
                  <div key={key}>
                    <dt className="text-muted-foreground text-sm">{t(`invoicing.${key}`)}</dt>
                    <dd className="text-xl font-semibold">
                      {invoicingSummary ? (
                        <Link
                          to={
                            key === 'invoicedThisMonth'
                              ? '/invoicing/invoices'
                              : `/invoicing/due-dates${key === 'overdue' ? '?status=overdue' : ''}`
                          }
                          className="underline-offset-4 hover:underline"
                        >
                          <MoneyAmount value={invoicingSummary[key]} />
                        </Link>
                      ) : (
                        '–'
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <Link to="/invoicing/invoices" className={buttonVariants({ variant: 'outline' })}>
                {t('invoicing.open')}
              </Link>
            </CardContent>
          </Card>
        )}
        {(warehouse || orders || invoicing) && (
          <div className="md:col-span-2">
            <Suspense fallback={null}>
              <OverviewCharts invoicing={invoicing} orders={orders} warehouse={warehouse} />
            </Suspense>
          </div>
        )}
        {inactive.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>{t('inactive.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">{t('inactive.description')}</p>
              <ul className="flex flex-col gap-2">
                {inactive.map((key) => (
                  <li key={key}>
                    <span className="font-medium">{t(`module.${key}`)}</span>
                    {' · '}
                    {t(`inactive.${key}`)}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
