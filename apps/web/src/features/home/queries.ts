import { keepPreviousData, useQuery } from '@tanstack/react-query';
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

/** The order counters of the overview, through the API as above; keyed like the orders' own. */
export function useOrdersSummary(enabled: boolean) {
  const company = useCompanyId();
  return useQuery({
    queryKey: ['orders', company, 'summary'],
    queryFn: () =>
      unwrap(api.GET('/orders/summary', { params: { header: { 'X-Company-Id': company ?? '' } } })),
    enabled: enabled && Boolean(company),
  });
}

/** The invoicing counters of the overview, through the API as above; keyed like invoicing's own. */
export function useInvoicingSummary(enabled: boolean) {
  const company = useCompanyId();
  return useQuery({
    queryKey: ['invoicing', company, 'summary'],
    queryFn: () =>
      unwrap(
        api.GET('/invoicing/summary', { params: { header: { 'X-Company-Id': company ?? '' } } }),
      ),
    enabled: enabled && Boolean(company),
  });
}

const companyHeader = (company: string | null) => ({ 'X-Company-Id': company ?? '' });

/**
 * The statistics of the overview, one request per module and year. Keyed under each module, so
 * that what refreshes the module refreshes its charts too; the previous year stays on screen
 * while the next one loads (no flash).
 */
export function useInvoicingStats(year: number, enabled: boolean) {
  const company = useCompanyId();
  return useQuery({
    queryKey: ['invoicing', company, 'stats', year],
    queryFn: () =>
      unwrap(
        api.GET('/invoicing/stats', {
          params: { header: companyHeader(company), query: { year } },
        }),
      ),
    enabled: enabled && Boolean(company),
    placeholderData: keepPreviousData,
  });
}

export function useAging(enabled: boolean) {
  const company = useCompanyId();
  return useQuery({
    queryKey: ['invoicing', company, 'aging'],
    queryFn: () =>
      unwrap(api.GET('/invoicing/aging', { params: { header: companyHeader(company) } })),
    enabled: enabled && Boolean(company),
  });
}

export function useOrdersStats(year: number, enabled: boolean) {
  const company = useCompanyId();
  return useQuery({
    queryKey: ['orders', company, 'stats', year],
    queryFn: () =>
      unwrap(
        api.GET('/orders/stats', { params: { header: companyHeader(company), query: { year } } }),
      ),
    enabled: enabled && Boolean(company),
    placeholderData: keepPreviousData,
  });
}

export function useStockStats(year: number, enabled: boolean) {
  const company = useCompanyId();
  return useQuery({
    queryKey: ['warehouse', company, 'stats', year],
    queryFn: () =>
      unwrap(
        api.GET('/stock/stats', { params: { header: companyHeader(company), query: { year } } }),
      ),
    enabled: enabled && Boolean(company),
    placeholderData: keepPreviousData,
  });
}
