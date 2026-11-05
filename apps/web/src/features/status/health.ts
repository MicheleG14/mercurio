import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '@/lib/health';

export type { HealthReport } from '@/lib/health';

export const statusKeys = {
  health: ['status', 'health'] as const,
};

const REFRESH_INTERVAL_MS = 15_000;

export function useHealth() {
  return useQuery({
    queryKey: statusKeys.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: REFRESH_INTERVAL_MS,
  });
}
