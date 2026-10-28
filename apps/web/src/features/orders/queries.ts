import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@/api/schema';
import { api, unwrap } from '@/lib/api-client';
import { useCompanyId } from '@/lib/auth/company';

export type Order = components['schemas']['OrderDto'];
export type OrderSummary = components['schemas']['OrderSummaryDto'];
export type OrderLine = components['schemas']['OrderLineDto'];
export type OrderKind = Order['kind'];
export type OrderStatus = Order['status'];
export type OrderItemOption = components['schemas']['OrderItemOptionDto'];
export type OrderPartyOption = components['schemas']['OrderPartyOptionDto'];
export type CreateOrderBody = components['schemas']['CreateOrderDto'];
export type OrderContent = Omit<CreateOrderBody, 'id' | 'kind'>;
export type FulfilmentBody = components['schemas']['CreateFulfilmentDto'];
export type ProposalLine = components['schemas']['ReorderProposalLineDto'];
export type VatCode = components['schemas']['ReferenceDataDto']['vatCodes'][number];

/** The company every order call works on (S5); the typed client asks for it explicitly. */
const header = (company: string | null) => ({ 'X-Company-Id': company ?? '' });

/** Query keys of the feature (F13), starting with the company, like the warehouse's. */
export const orderKeys = {
  all: (company: string | null) => ['orders', company] as const,
  list: (company: string | null, query: object) => ['orders', company, 'list', query] as const,
  order: (company: string | null, id: string) => ['orders', company, 'order', id] as const,
  summary: (company: string | null) => ['orders', company, 'summary'] as const,
  incoming: (company: string | null, itemId: string) =>
    ['orders', company, 'incoming', itemId] as const,
  proposal: (company: string | null, warehouseId: string) =>
    ['orders', company, 'proposal', warehouseId] as const,
  warehouses: (company: string | null) => ['orders', company, 'warehouses'] as const,
  itemSearch: (company: string | null, warehouseId: string | undefined) =>
    ['orders', company, 'item-search', warehouseId ?? null] as const,
  partySearch: (company: string | null, kind: OrderKind) =>
    ['orders', company, 'party-search', kind] as const,
  vatCodes: ['orders', 'vat-codes'] as const,
};

export interface OrdersQuery {
  kind: OrderKind;
  page: number;
  q?: string;
  sort?: string;
  status?: OrderStatus | 'OPEN';
  partyId?: string;
  warehouseId?: string;
  uncovered?: boolean;
  late?: boolean;
}

export function useOrders(query: OrdersQuery) {
  const company = useCompanyId();
  return useQuery({
    queryKey: orderKeys.list(company, query),
    queryFn: () =>
      unwrap(
        api.GET('/orders', {
          params: { header: header(company), query: { pageSize: 25, ...query } },
        }),
      ),
    enabled: Boolean(company),
    placeholderData: keepPreviousData,
  });
}

export function useOrder(id: string) {
  const company = useCompanyId();
  return useQuery({
    queryKey: orderKeys.order(company, id),
    queryFn: () =>
      unwrap(api.GET('/orders/{id}', { params: { header: header(company), path: { id } } })),
    enabled: Boolean(company) && Boolean(id),
  });
}

export function useOrdersSummary(enabled: boolean) {
  const company = useCompanyId();
  return useQuery({
    queryKey: orderKeys.summary(company),
    queryFn: () => unwrap(api.GET('/orders/summary', { params: { header: header(company) } })),
    enabled: enabled && Boolean(company),
  });
}

export function useReorderProposal(warehouseId: string | null) {
  const company = useCompanyId();
  return useQuery({
    queryKey: orderKeys.proposal(company, warehouseId ?? ''),
    queryFn: () =>
      unwrap(
        api.GET('/orders/reorder-proposal', {
          params: { header: header(company), query: { warehouseId: warehouseId! } },
        }),
      ),
    enabled: Boolean(company) && Boolean(warehouseId),
  });
}

/**
 * The warehouses an order can name. Read from the warehouse's API: the orders feature calls it,
 * it does not import the warehouse feature (F11).
 */
export function useOrderWarehouses() {
  const company = useCompanyId();
  return useQuery({
    queryKey: orderKeys.warehouses(company),
    queryFn: () =>
      unwrap(
        api.GET('/warehouses', {
          params: { header: header(company), query: { pageSize: 100, archived: false } },
        }),
      ),
    enabled: Boolean(company),
  });
}

/** The VAT catalog, the same for everyone: from the registry's reference data. */
export function useVatCodes() {
  return useQuery({
    queryKey: orderKeys.vatCodes,
    queryFn: async () => (await unwrap(api.GET('/registry/reference-data'))).vatCodes,
    staleTime: Infinity,
  });
}

/** Search functions for SearchCombobox: items for a line, parties for the header. */
export function useOrderItemSearch(warehouseId: string | undefined) {
  const company = useCompanyId();
  return {
    queryKey: orderKeys.itemSearch(company, warehouseId),
    search: (q: string) =>
      unwrap(
        api.GET('/orders/items-search', {
          params: { header: header(company), query: { q: q || undefined, warehouseId } },
        }),
      ),
  };
}

export function useOrderPartySearch(kind: OrderKind) {
  const company = useCompanyId();
  return {
    queryKey: orderKeys.partySearch(company, kind),
    search: (q: string) =>
      unwrap(
        api.GET('/orders/parties-search', {
          params: { header: header(company), query: { q: q || undefined, kind } },
        }),
      ),
  };
}

/**
 * After an order changes, so may stock, reservations and stock documents of the same company:
 * every cached query of that company goes stale, whichever feature owns it.
 */
function useInvalidateCompany() {
  const queryClient = useQueryClient();
  const company = useCompanyId();
  return () =>
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === company });
}

export function useSaveOrder() {
  const invalidate = useInvalidateCompany();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (input: { body: CreateOrderBody; version?: number }) =>
      input.version === undefined
        ? unwrap(api.POST('/orders', { params: { header: header(company) }, body: input.body }))
        : unwrap(
            api.PUT('/orders/{id}', {
              params: { header: header(company), path: { id: input.body.id } },
              body: { ...withoutCreateFields(input.body), version: input.version },
            }),
          ),
    onSuccess: invalidate,
  });
}

function withoutCreateFields({ id: _id, kind: _kind, ...content }: CreateOrderBody): OrderContent {
  return content;
}

/** The actions on an order once it exists, each answering with the order as it is now. */
export function useOrderAction(id: string) {
  const invalidate = useInvalidateCompany();
  const company = useCompanyId();
  const params = { header: header(company), path: { id } };
  return useMutation({
    mutationFn: (
      action:
        | { type: 'confirm'; version: number }
        | { type: 'reserve' }
        | { type: 'close'; version: number; lineIds?: string[] }
        | { type: 'cancel'; version: number }
        | { type: 'duplicate'; newId: string }
        | { type: 'reverse'; fulfilmentId: string },
    ) => {
      switch (action.type) {
        case 'confirm':
          return unwrap(
            api.POST('/orders/{id}/confirm', { params, body: { version: action.version } }),
          );
        case 'reserve':
          return unwrap(api.POST('/orders/{id}/reserve', { params }));
        case 'close':
          return unwrap(
            api.POST('/orders/{id}/close', {
              params,
              body: { version: action.version, lineIds: action.lineIds },
            }),
          );
        case 'cancel':
          return unwrap(
            api.POST('/orders/{id}/cancel', { params, body: { version: action.version } }),
          );
        case 'duplicate':
          return unwrap(api.POST('/orders/{id}/duplicate', { params, body: { id: action.newId } }));
        case 'reverse':
          return unwrap(
            api.POST('/orders/{id}/fulfilments/{fulfilmentId}/reverse', {
              params: { ...params, path: { id, fulfilmentId: action.fulfilmentId } },
            }),
          );
      }
    },
    onSuccess: invalidate,
  });
}

export function useDeleteOrder(id: string) {
  const invalidate = useInvalidateCompany();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (version: number) =>
      unwrap(
        api.DELETE('/orders/{id}', {
          params: { header: header(company), path: { id }, query: { version } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useFulfil(id: string) {
  const invalidate = useInvalidateCompany();
  const company = useCompanyId();
  return useMutation({
    mutationFn: (body: FulfilmentBody) =>
      unwrap(
        api.POST('/orders/{id}/fulfilments', {
          params: { header: header(company), path: { id } },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}
