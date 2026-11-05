import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@/api/schema';
import { api, unwrap } from '@/lib/api-client';
import { useCompanyId } from '@/lib/auth/company';

export type Company = components['schemas']['CompanyDto'];
export type UpdateCompanyBody = components['schemas']['UpdateCompanyDto'];

const header = (company: string | null) => ({ 'X-Company-Id': company ?? '' });

/** The invoice header data of the current company. Keyed like invoicing's, which reads it too. */
export function useCompanyData() {
  const company = useCompanyId();
  return useQuery({
    queryKey: ['invoicing', company, 'company'],
    queryFn: () => unwrap(api.GET('/companies/current', { params: { header: header(company) } })),
    enabled: Boolean(company),
  });
}

export function useSaveCompanyData() {
  const queryClient = useQueryClient();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (body: UpdateCompanyBody) =>
      unwrap(api.PUT('/companies/current', { params: { header: header(company) }, body })),
    onSuccess: (saved) => queryClient.setQueryData(['invoicing', company, 'company'], saved),
  });
}

/** The tax regimes of the catalog, from the registry's reference data. */
export function useTaxRegimes() {
  return useQuery({
    queryKey: ['settings', 'tax-regimes'],
    queryFn: async () => (await unwrap(api.GET('/registry/reference-data'))).taxRegimes,
    staleTime: Infinity,
  });
}
