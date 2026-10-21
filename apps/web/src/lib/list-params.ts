import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import type { SortOrder } from '@/components/shared/DataTable';

/**
 * State of a server-side list (search, filters, order, page) kept in the address,
 * `?q=…&role=…&sort=name:asc&page=2`: the back button and a shared link bring back the same list.
 * Changing anything but the page goes back to page 1. History is replaced, not added to, so
 * typing a search does not fill the back button with one entry per letter.
 */
export function useListParams<F extends string>(filterKeys: readonly F[], defaultSort: SortOrder) {
  const [params, setParams] = useSearchParams();

  const update = useCallback(
    (patch: Record<string, string | undefined>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '') next.delete(key);
            else next.set(key, value);
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const [field, direction] = (params.get('sort') ?? '').split(':');
  const sort: SortOrder =
    field && (direction === 'asc' || direction === 'desc') ? { field, direction } : defaultSort;
  const filters = Object.fromEntries(
    filterKeys.map((key) => [key, params.get(key) ?? undefined]),
  ) as Record<F, string | undefined>;

  return {
    page,
    q: params.get('q') ?? '',
    sort,
    filters,
    setPage: useCallback(
      (value: number) => update({ page: value > 1 ? String(value) : undefined }),
      [update],
    ),
    setQuery: useCallback((value: string) => update({ q: value }), [update]),
    setSort: useCallback(
      (value: SortOrder) => update({ sort: `${value.field}:${value.direction}` }),
      [update],
    ),
    setFilter: useCallback(
      (key: F, value: string | undefined) => update({ [key]: value }),
      [update],
    ),
  };
}
