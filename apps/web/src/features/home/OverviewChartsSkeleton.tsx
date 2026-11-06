import { useTranslation } from 'react-i18next';
import { ChartCardSkeleton } from '@/components/shared/ChartCardSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

/** The cards of each module, in the places of the overview's charts (OverviewCharts). */
export function InvoicingChartsSkeleton() {
  return (
    <>
      <ChartCardSkeleton className="lg:col-span-2" />
      <ChartCardSkeleton />
      <ChartCardSkeleton />
    </>
  );
}

export function OrdersChartsSkeleton() {
  return (
    <>
      <ChartCardSkeleton />
      <ChartCardSkeleton />
    </>
  );
}

export function StockChartsSkeleton() {
  return <ChartCardSkeleton className="lg:col-span-2" />;
}

/**
 * The charts' section while their code loads (they are a chunk of their own): the same cards
 * the figures will fill, so that the page does not jump.
 */
export function OverviewChartsSkeleton({
  invoicing,
  orders,
  warehouse,
}: {
  invoicing: boolean;
  orders: boolean;
  warehouse: boolean;
}) {
  const { t } = useTranslation('home');
  return (
    <section className="flex flex-col gap-4" aria-busy="true" aria-label={t('charts.loading')}>
      <Skeleton className="h-9 w-48" aria-hidden="true" />
      <div className="grid gap-4 lg:grid-cols-2">
        {invoicing && <InvoicingChartsSkeleton />}
        {orders && <OrdersChartsSkeleton />}
        {warehouse && <StockChartsSkeleton />}
      </div>
    </section>
  );
}
