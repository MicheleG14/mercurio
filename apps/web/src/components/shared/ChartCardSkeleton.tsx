import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The place of a chart while its figures load: a card of the same shape, so that the page does
 * not jump when the chart arrives. Hidden from screen readers: the section around it says that
 * it is loading (aria-busy).
 */
export function ChartCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('min-w-0', className)} aria-hidden="true">
      <CardHeader className="flex flex-col gap-2">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-56 w-full" />
      </CardContent>
    </Card>
  );
}
