import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@/api/schema';
import { api, unwrap } from '@/lib/api-client';

export type Party = components['schemas']['PartyDto'];
export type PartySummary = components['schemas']['PartySummaryDto'];
export type PartyBody = components['schemas']['CreatePartyDto'];
export type Item = components['schemas']['ItemDto'];
export type ItemBody = components['schemas']['CreateItemDto'];
export type ReferenceData = components['schemas']['ReferenceDataDto'];

/** Query keys of the feature, in one place (F13). */
export const registryKeys = {
  referenceData: ['registry', 'reference-data'] as const,
  parties: ['registry', 'parties'] as const,
  partyList: (query: object) => ['registry', 'parties', 'list', query] as const,
  party: (id: string) => ['registry', 'parties', 'detail', id] as const,
  partyLookup: (query: object) => ['registry', 'parties', 'lookup', query] as const,
  items: ['registry', 'items'] as const,
  itemList: (query: object) => ['registry', 'items', 'list', query] as const,
  item: (id: string) => ['registry', 'items', 'detail', id] as const,
};

/** Catalogs from the backend, their only source; they change only with a release. */
export function useReferenceData() {
  return useQuery({
    queryKey: registryKeys.referenceData,
    queryFn: () => unwrap(api.GET('/registry/reference-data')),
    staleTime: Infinity,
  });
}

export interface ListQuery {
  page: number;
  q?: string;
  sort?: string;
  archived?: boolean;
}

export function useParties(query: ListQuery & { role?: 'customer' | 'supplier' }) {
  return useQuery({
    queryKey: registryKeys.partyList(query),
    queryFn: () => unwrap(api.GET('/parties', { params: { query: { pageSize: 25, ...query } } })),
    // While the next page or search loads, the current rows stay on screen.
    placeholderData: keepPreviousData,
  });
}

export function useParty(id: string | undefined) {
  return useQuery({
    queryKey: registryKeys.party(id ?? ''),
    queryFn: () => unwrap(api.GET('/parties/{id}', { params: { path: { id: id! } } })),
    enabled: Boolean(id),
  });
}

/** Parties that already have this VAT number or tax code (archived ones too). */
export function usePartyLookup(query: { vatNumber?: string; taxCode?: string }) {
  return useQuery({
    queryKey: registryKeys.partyLookup(query),
    queryFn: () => unwrap(api.GET('/parties/lookup', { params: { query } })),
    enabled: Boolean(query.vatNumber || query.taxCode),
  });
}

export function useItems(query: ListQuery & { stockManaged?: boolean }) {
  return useQuery({
    queryKey: registryKeys.itemList(query),
    queryFn: () => unwrap(api.GET('/items', { params: { query: { pageSize: 25, ...query } } })),
    placeholderData: keepPreviousData,
  });
}

export function useItem(id: string | undefined) {
  return useQuery({
    queryKey: registryKeys.item(id ?? ''),
    queryFn: () => unwrap(api.GET('/items/{id}', { params: { path: { id: id! } } })),
    enabled: Boolean(id),
  });
}

/**
 * After a change: the record gets the saved version as it is (no need to ask again), lists and
 * lookups of that entity are asked again.
 */
function useSaved<T extends { id: string }>(
  detailKey: (id: string) => readonly unknown[],
  entityKey: readonly unknown[],
) {
  const queryClient = useQueryClient();
  return (saved: T) => {
    queryClient.setQueryData(detailKey(saved.id), saved);
    void queryClient.invalidateQueries({
      queryKey: entityKey,
      predicate: (query) => query.queryKey[2] !== 'detail',
    });
  };
}

export function useSaveParty(id: string | undefined) {
  const onSuccess = useSaved<Party>(registryKeys.party, registryKeys.parties);
  return useMutation({
    mutationFn: (body: PartyBody & { version?: number }) =>
      id
        ? unwrap(
            api.PATCH('/parties/{id}', {
              params: { path: { id } },
              body: { ...body, version: body.version! },
            }),
          )
        : unwrap(api.POST('/parties', { body })),
    onSuccess,
  });
}

export function useArchiveParty(id: string) {
  const onSuccess = useSaved<Party>(registryKeys.party, registryKeys.parties);
  return useMutation({
    mutationFn: ({ archive, version }: { archive: boolean; version: number }) =>
      unwrap(
        archive
          ? api.POST('/parties/{id}/archive', { params: { path: { id } }, body: { version } })
          : api.POST('/parties/{id}/restore', { params: { path: { id } }, body: { version } }),
      ),
    onSuccess,
  });
}

export function useSaveItem(id: string | undefined) {
  const onSuccess = useSaved<Item>(registryKeys.item, registryKeys.items);
  return useMutation({
    mutationFn: (body: ItemBody & { version?: number }) => {
      if (!id) return unwrap(api.POST('/items', { body }));
      // Code and "stock managed" never change once created: they are not part of a change.
      const { code: _code, stockManaged: _stockManaged, ...change } = body;
      return unwrap(
        api.PATCH('/items/{id}', {
          params: { path: { id } },
          body: { ...change, version: body.version! },
        }),
      );
    },
    onSuccess,
  });
}

export function useArchiveItem(id: string) {
  const onSuccess = useSaved<Item>(registryKeys.item, registryKeys.items);
  return useMutation({
    mutationFn: ({ archive, version }: { archive: boolean; version: number }) =>
      unwrap(
        archive
          ? api.POST('/items/{id}/archive', { params: { path: { id } }, body: { version } })
          : api.POST('/items/{id}/restore', { params: { path: { id } }, body: { version } }),
      ),
    onSuccess,
  });
}
