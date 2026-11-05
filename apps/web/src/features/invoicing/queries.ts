import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@/api/schema';
import { ApiError } from '@/lib/api';
import { api, unwrap } from '@/lib/api-client';
import { useCompanyId } from '@/lib/auth/company';

export type Invoice = components['schemas']['InvoiceDto'];
export type InvoiceSummary = components['schemas']['InvoiceSummaryDto'];
export type InvoiceDraft = components['schemas']['InvoiceDraftDto'];
export type DocumentLine = components['schemas']['DocumentLineDto'];
export type DraftLineInput = components['schemas']['DraftLineInputDto'];
export type CreateDraftBody = components['schemas']['CreateDraftDto'];
export type UpdateDraftBody = components['schemas']['UpdateDraftDto'];
export type ToInvoice = components['schemas']['ToInvoiceDto'];
export type ScheduleRow = components['schemas']['ScheduleRowDto'];
export type Payment = components['schemas']['PaymentDto'];
export type CreatePaymentBody = components['schemas']['CreatePaymentDto'];
export type CustomerOption = components['schemas']['CustomerOptionDto'];
export type InvoiceItemOption = components['schemas']['InvoiceItemOptionDto'];
export type Company = components['schemas']['CompanyDto'];
export type PaymentStatus = Invoice['paymentStatus'];
export type InvoiceKind = Invoice['kind'];

/** The company every invoicing call works on (S5); the typed client asks for it explicitly. */
const header = (company: string | null) => ({ 'X-Company-Id': company ?? '' });

/** Query keys of the feature (F13), starting with the company, like the other features'. */
export const invoicingKeys = {
  list: (company: string | null, query: object) => ['invoicing', company, 'list', query] as const,
  invoice: (company: string | null, id: string) => ['invoicing', company, 'invoice', id] as const,
  drafts: (company: string | null, page: number) => ['invoicing', company, 'drafts', page] as const,
  draft: (company: string | null, id: string) => ['invoicing', company, 'draft', id] as const,
  toInvoice: (company: string | null, query: object) =>
    ['invoicing', company, 'to-invoice', query] as const,
  dueDates: (company: string | null, query: object) =>
    ['invoicing', company, 'due-dates', query] as const,
  payments: (company: string | null, query: object) =>
    ['invoicing', company, 'payments', query] as const,
  summary: (company: string | null) => ['invoicing', company, 'summary'] as const,
  company: (company: string | null) => ['invoicing', company, 'company'] as const,
  customerSearch: (company: string | null) => ['invoicing', company, 'customer-search'] as const,
  itemSearch: (company: string | null) => ['invoicing', company, 'item-search'] as const,
  referenceData: ['invoicing', 'reference-data'] as const,
};

export interface InvoicesQuery {
  page: number;
  q?: string;
  kind?: InvoiceKind;
  partyId?: string;
  from?: string;
  to?: string;
}

export function useInvoices(query: InvoicesQuery) {
  const company = useCompanyId();
  return useQuery({
    queryKey: invoicingKeys.list(company, query),
    queryFn: () =>
      unwrap(
        api.GET('/invoices', {
          params: { header: header(company), query: { pageSize: 25, ...query } },
        }),
      ),
    enabled: Boolean(company),
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: string) {
  const company = useCompanyId();
  return useQuery({
    queryKey: invoicingKeys.invoice(company, id),
    queryFn: () =>
      unwrap(api.GET('/invoices/{id}', { params: { header: header(company), path: { id } } })),
    enabled: Boolean(company) && Boolean(id),
  });
}

export function useDrafts(page: number) {
  const company = useCompanyId();
  return useQuery({
    queryKey: invoicingKeys.drafts(company, page),
    queryFn: () =>
      unwrap(
        api.GET('/invoice-drafts', {
          params: { header: header(company), query: { page, pageSize: 25 } },
        }),
      ),
    enabled: Boolean(company),
  });
}

export function useDraft(id: string) {
  const company = useCompanyId();
  return useQuery({
    queryKey: invoicingKeys.draft(company, id),
    queryFn: () =>
      unwrap(
        api.GET('/invoice-drafts/{id}', { params: { header: header(company), path: { id } } }),
      ),
    enabled: Boolean(company) && Boolean(id),
    // A draft that was just issued is gone: no retries on its 404.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export function useToInvoice(query: { page: number; partyId?: string }) {
  const company = useCompanyId();
  return useQuery({
    queryKey: invoicingKeys.toInvoice(company, query),
    queryFn: () =>
      unwrap(
        api.GET('/invoicing/to-invoice', {
          params: { header: header(company), query: { pageSize: 100, ...query } },
        }),
      ),
    enabled: Boolean(company),
    placeholderData: keepPreviousData,
  });
}

export interface DueDatesQuery {
  page: number;
  status?: 'open' | 'overdue' | 'paid';
  partyId?: string;
  from?: string;
  to?: string;
  pageSize?: number;
}

export function useDueDates(query: DueDatesQuery, enabled = true) {
  const company = useCompanyId();
  return useQuery({
    queryKey: invoicingKeys.dueDates(company, query),
    queryFn: () =>
      unwrap(
        api.GET('/invoicing/due-dates', {
          params: { header: header(company), query: { pageSize: 50, ...query } },
        }),
      ),
    enabled: enabled && Boolean(company),
    placeholderData: keepPreviousData,
  });
}

export function usePayments(query: { page: number; partyId?: string }) {
  const company = useCompanyId();
  return useQuery({
    queryKey: invoicingKeys.payments(company, query),
    queryFn: () =>
      unwrap(
        api.GET('/payments', {
          params: { header: header(company), query: { pageSize: 25, ...query } },
        }),
      ),
    enabled: Boolean(company),
    placeholderData: keepPreviousData,
  });
}

export function useInvoicingSummary(enabled: boolean) {
  const company = useCompanyId();
  return useQuery({
    queryKey: invoicingKeys.summary(company),
    queryFn: () => unwrap(api.GET('/invoicing/summary', { params: { header: header(company) } })),
    enabled: enabled && Boolean(company),
  });
}

/** The header data of the current company, as invoices print it. */
export function useCompany(enabled = true) {
  const company = useCompanyId();
  return useQuery({
    queryKey: invoicingKeys.company(company),
    queryFn: () => unwrap(api.GET('/companies/current', { params: { header: header(company) } })),
    enabled: enabled && Boolean(company),
  });
}

/** VAT codes, payment terms and methods, tax regimes: the catalogs of the registry. */
export function useReferenceData() {
  return useQuery({
    queryKey: invoicingKeys.referenceData,
    queryFn: () => unwrap(api.GET('/registry/reference-data')),
    staleTime: Infinity,
  });
}

/** Search functions for SearchCombobox: customers for the header, items for a line. */
export function useCustomerSearch() {
  const company = useCompanyId();
  return {
    queryKey: invoicingKeys.customerSearch(company),
    search: (q: string) =>
      unwrap(
        api.GET('/invoicing/parties-search', {
          params: { header: header(company), query: { q: q || undefined } },
        }),
      ),
  };
}

export function useInvoiceItemSearch() {
  const company = useCompanyId();
  return {
    queryKey: invoicingKeys.itemSearch(company),
    search: (q: string) =>
      unwrap(
        api.GET('/invoicing/items-search', {
          params: { header: header(company), query: { q: q || undefined } },
        }),
      ),
  };
}

/**
 * After an invoicing action, shipments, documents and payments of the same company change
 * together, and an order's shipment may stop being undoable: every cached query of that company
 * goes stale, whichever feature owns it.
 */
function useInvalidateCompany() {
  const queryClient = useQueryClient();
  const company = useCompanyId();
  return () =>
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === company });
}

export function useCreateDraft() {
  const invalidate = useInvalidateCompany();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (body: CreateDraftBody) =>
      unwrap(api.POST('/invoice-drafts', { params: { header: header(company) }, body })),
    onSuccess: invalidate,
  });
}

export function useSaveDraft(id: string) {
  const invalidate = useInvalidateCompany();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (body: UpdateDraftBody) =>
      unwrap(
        api.PUT('/invoice-drafts/{id}', {
          params: { header: header(company), path: { id } },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteDraft(id: string) {
  const invalidate = useInvalidateCompany();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (version: number) =>
      unwrap(
        api.DELETE('/invoice-drafts/{id}', {
          params: { header: header(company), path: { id }, query: { version } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useIssue(id: string) {
  const invalidate = useInvalidateCompany();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (body: { version: number; issueDate?: string }) =>
      unwrap(
        api.POST('/invoice-drafts/{id}/issue', {
          params: { header: header(company), path: { id } },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useCreditNote(invoiceId: string) {
  const invalidate = useInvalidateCompany();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (body: { id: string; lineIds?: string[] }) =>
      unwrap(
        api.POST('/invoices/{id}/credit-note', {
          params: { header: header(company), path: { id: invoiceId } },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useRecordPayment() {
  const invalidate = useInvalidateCompany();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (body: CreatePaymentBody) =>
      unwrap(api.POST('/payments', { params: { header: header(company) }, body })),
    onSuccess: invalidate,
  });
}

export function useReversePayment() {
  const invalidate = useInvalidateCompany();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/payments/{id}/reverse', { params: { header: header(company), path: { id } } }),
      ),
    onSuccess: invalidate,
  });
}

/** Saves a PDF the API prints: the browser downloads it with the name the API gives. */
function save(blob: Blob, response: Response, fallback: string) {
  const name =
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? fallback;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Downloads the FatturaPA file of an issued document (FPR12): only the file, nothing is sent.
 * A refusal keeps its problem (XML_DATA_INCOMPLETE names the fields).
 */
export function useFatturaPa() {
  const company = useCompanyId();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error, response } = await api.GET('/invoices/{id}/xml', {
        params: { header: header(company), path: { id } },
        parseAs: 'text',
      });
      if (!response.ok || data === undefined) {
        const problem =
          typeof error === 'object' && error !== null && 'code' in error ? error : undefined;
        throw new ApiError(response.status, problem as ConstructorParameters<typeof ApiError>[1]);
      }
      save(new Blob([data as string], { type: 'application/xml' }), response, `${id}.xml`);
    },
  });
}

/** Downloads the PDF of an issued document, or the preview of a draft. */
export function usePdf() {
  const company = useCompanyId();
  return useMutation({
    mutationFn: async (target: { kind: 'invoice' | 'draft'; id: string }) => {
      const params = { header: header(company), path: { id: target.id } };
      const { data, response } =
        target.kind === 'invoice'
          ? await api.GET('/invoices/{id}/pdf', { params, parseAs: 'blob' })
          : await api.GET('/invoice-drafts/{id}/pdf', { params, parseAs: 'blob' });
      if (!response.ok || !data) throw new ApiError(response.status);
      save(data as Blob, response, `${target.kind}-${target.id}.pdf`);
    },
  });
}
