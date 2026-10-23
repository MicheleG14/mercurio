import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@/api/schema';
import { api, unwrap } from '@/lib/api-client';
import { useCompanyId } from '@/lib/auth/company';

export type Warehouse = components['schemas']['WarehouseDto'];
export type StockRow = components['schemas']['StockRowDto'];
export type ItemStock = components['schemas']['ItemStockDto'];
export type ItemOption = components['schemas']['ItemOptionDto'];
export type PartyOption = components['schemas']['PartyOptionDto'];
export type StockDocument = components['schemas']['StockDocumentDto'];
export type StockDocumentSummary = components['schemas']['StockDocumentSummaryDto'];
export type StockDocumentBody = components['schemas']['CreateStockDocumentDto'];
export type DocumentType = StockDocumentSummary['type'];
export type Reason = StockDocumentBody['reason'];

/**
 * The company every warehouse call works on (S5). The auth middleware adds the same header to
 * every request; the API contract requires it here, so the typed client asks for it explicitly.
 */
const header = (company: string | null) => ({ 'X-Company-Id': company ?? '' });

/**
 * Query keys of the feature, in one place (F13). Every key starts with the company: the warehouse
 * works on one company (the X-Company-Id header), and choosing another must not show the cached
 * stock of the first.
 */
export const warehouseKeys = {
  all: (company: string | null) => ['warehouse', company] as const,
  warehouses: (company: string | null, query: object) =>
    ['warehouse', company, 'warehouses', query] as const,
  stock: (company: string | null, query: object) => ['warehouse', company, 'stock', query] as const,
  item: (company: string | null, id: string) => ['warehouse', company, 'item', id] as const,
  movements: (company: string | null, id: string, query: object) =>
    ['warehouse', company, 'movements', id, query] as const,
  summary: (company: string | null) => ['warehouse', company, 'summary'] as const,
  documents: (company: string | null, query: object) =>
    ['warehouse', company, 'documents', query] as const,
  document: (company: string | null, id: string) => ['warehouse', company, 'document', id] as const,
  itemSearch: (company: string | null, warehouseId: string | undefined) =>
    ['warehouse', company, 'item-search', warehouseId ?? null] as const,
  partySearch: (company: string | null, role: string) =>
    ['warehouse', company, 'party-search', role] as const,
};

export function useWarehouses(query: { archived?: boolean; page?: number } = {}) {
  const company = useCompanyId();
  return useQuery({
    queryKey: warehouseKeys.warehouses(company, query),
    queryFn: () =>
      unwrap(
        api.GET('/warehouses', {
          params: { header: header(company), query: { pageSize: 100, ...query } },
        }),
      ),
    enabled: Boolean(company),
  });
}

export interface StockQuery {
  page: number;
  q?: string;
  sort?: string;
  warehouseId?: string;
  belowReorder?: boolean;
  includeZero?: boolean;
  asOf?: string;
}

export function useStock(query: StockQuery) {
  const company = useCompanyId();
  return useQuery({
    queryKey: warehouseKeys.stock(company, query),
    queryFn: () =>
      unwrap(
        api.GET('/stock', {
          params: { header: header(company), query: { pageSize: 25, ...query } },
        }),
      ),
    enabled: Boolean(company),
    placeholderData: keepPreviousData,
  });
}

export function useStockSummary(enabled: boolean) {
  const company = useCompanyId();
  return useQuery({
    queryKey: warehouseKeys.summary(company),
    queryFn: () => unwrap(api.GET('/stock/summary', { params: { header: header(company) } })),
    enabled: enabled && Boolean(company),
  });
}

export function useItemStock(itemId: string) {
  const company = useCompanyId();
  return useQuery({
    queryKey: warehouseKeys.item(company, itemId),
    queryFn: () =>
      unwrap(
        api.GET('/stock/items/{itemId}', {
          params: { header: header(company), path: { itemId } },
        }),
      ),
    enabled: Boolean(company),
  });
}

export function useMovements(itemId: string, query: { page: number; warehouseId?: string }) {
  const company = useCompanyId();
  return useQuery({
    queryKey: warehouseKeys.movements(company, itemId, query),
    queryFn: () =>
      unwrap(
        api.GET('/stock/items/{itemId}/movements', {
          params: { header: header(company), path: { itemId }, query: { pageSize: 25, ...query } },
        }),
      ),
    enabled: Boolean(company),
    placeholderData: keepPreviousData,
  });
}

export interface DocumentsQuery {
  page: number;
  q?: string;
  sort?: string;
  type?: DocumentType;
  warehouseId?: string;
  from?: string;
  to?: string;
}

export function useStockDocuments(query: DocumentsQuery) {
  const company = useCompanyId();
  return useQuery({
    queryKey: warehouseKeys.documents(company, query),
    queryFn: () =>
      unwrap(
        api.GET('/stock-documents', {
          params: { header: header(company), query: { pageSize: 25, ...query } },
        }),
      ),
    enabled: Boolean(company),
    placeholderData: keepPreviousData,
  });
}

export function useStockDocument(id: string) {
  const company = useCompanyId();
  return useQuery({
    queryKey: warehouseKeys.document(company, id),
    queryFn: () =>
      unwrap(
        api.GET('/stock-documents/{id}', {
          params: { header: header(company), path: { id } },
        }),
      ),
    enabled: Boolean(company),
  });
}

/** Search functions for SearchCombobox: items for a line, parties for the header. */
export function useItemSearch(warehouseId: string | undefined) {
  const company = useCompanyId();
  return {
    queryKey: warehouseKeys.itemSearch(company, warehouseId),
    search: (q: string) =>
      unwrap(
        api.GET('/stock/items-search', {
          params: { header: header(company), query: { q: q || undefined, warehouseId } },
        }),
      ),
  };
}

export function usePartySearch(role: 'supplier' | 'customer') {
  const company = useCompanyId();
  return {
    queryKey: warehouseKeys.partySearch(company, role),
    search: (q: string) =>
      unwrap(
        api.GET('/stock/parties-search', {
          params: { header: header(company), query: { q: q || undefined, role } },
        }),
      ),
  };
}

/** After any change, everything of the warehouse may be different: stock, lists, summary. */
function useInvalidateAll() {
  const queryClient = useQueryClient();
  const company = useCompanyId();
  return () => queryClient.invalidateQueries({ queryKey: warehouseKeys.all(company) });
}

export function usePostDocument() {
  const invalidate = useInvalidateAll();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (body: StockDocumentBody) =>
      unwrap(api.POST('/stock-documents', { params: { header: header(company) }, body })),
    onSuccess: invalidate,
  });
}

export function useReverseDocument(id: string) {
  const invalidate = useInvalidateAll();
  const company = useCompanyId();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/stock-documents/{id}/reverse', {
          params: { header: header(company), path: { id } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useSetReorderLevel() {
  const invalidate = useInvalidateAll();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (input: {
      warehouseId: string;
      itemId: string;
      reorderPoint: string;
      reorderQuantity: string | null;
      version?: number;
    }) =>
      unwrap(
        api.PUT('/stock/reorder-levels/{warehouseId}/{itemId}', {
          params: {
            header: header(company),
            path: { warehouseId: input.warehouseId, itemId: input.itemId },
          },
          body: {
            reorderPoint: input.reorderPoint,
            reorderQuantity: input.reorderQuantity,
            version: input.version,
          },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useRemoveReorderLevel() {
  const invalidate = useInvalidateAll();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (input: { warehouseId: string; itemId: string; version: number }) =>
      unwrap(
        api.DELETE('/stock/reorder-levels/{warehouseId}/{itemId}', {
          params: {
            header: header(company),
            path: { warehouseId: input.warehouseId, itemId: input.itemId },
            query: { version: input.version },
          },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useSaveWarehouse() {
  const invalidate = useInvalidateAll();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (input: { id?: string; code: string; name: string; version?: number }) =>
      input.id
        ? unwrap(
            api.PATCH('/warehouses/{id}', {
              params: { header: header(company), path: { id: input.id } },
              body: { name: input.name, version: input.version! },
            }),
          )
        : unwrap(
            api.POST('/warehouses', {
              params: { header: header(company) },
              body: { code: input.code, name: input.name },
            }),
          ),
    onSuccess: invalidate,
  });
}

export function useArchiveWarehouse() {
  const invalidate = useInvalidateAll();
  const company = useCompanyId();
  return useMutation({
    mutationFn: ({ id, archive, version }: { id: string; archive: boolean; version: number }) =>
      unwrap(
        archive
          ? api.POST('/warehouses/{id}/archive', {
              params: { header: header(company), path: { id } },
              body: { version },
            })
          : api.POST('/warehouses/{id}/restore', {
              params: { header: header(company), path: { id } },
              body: { version },
            }),
      ),
    onSuccess: invalidate,
  });
}
