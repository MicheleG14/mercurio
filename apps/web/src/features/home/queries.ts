import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api-client';
import { useCompanyId } from '@/lib/auth/company';

/**
 * The warehouse counters of the overview. Asked here, through the API, not through the warehouse
 * feature: a feature does not import another one (F12). The key starts like the warehouse's own,
 * so a recorded document refreshes it too.
 */
export function useStockSummary(enabled: boolean) {
  const company = useCompanyId();
  return useQuery({
    queryKey: ['warehouse', company, 'summary'],
    queryFn: () =>
      unwrap(api.GET('/stock/summary', { params: { header: { 'X-Company-Id': company ?? '' } } })),
    enabled: enabled && Boolean(company),
  });
}
