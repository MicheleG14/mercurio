import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api-client';

export function useAuditEvents(query: { page: number; type?: string }) {
  return useQuery({
    queryKey: ['audit', 'events', query] as const,
    queryFn: () =>
      unwrap(
        api.GET('/audit-events', {
          params: {
            query: {
              page: query.page,
              pageSize: 25,
              type: query.type as never,
            },
          },
        }),
      ),
  });
}
