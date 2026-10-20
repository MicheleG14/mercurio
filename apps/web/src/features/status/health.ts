import { useQuery } from '@tanstack/react-query';
import { ApiError, apiUrl } from '@/lib/api';

/** Mirrors HealthResponseDto of the API. From phase 1 these types are generated from OpenAPI. */
export interface HealthReport {
  status: 'ok' | 'degraded';
  /** tenantIsolation is down when the API's database role could bypass Row-Level Security. */
  checks: { database: 'up' | 'down'; tenantIsolation: 'up' | 'down' };
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

export const statusKeys = {
  health: ['status', 'health'] as const,
};

const REFRESH_INTERVAL_MS = 15_000;

export async function fetchHealth(signal?: AbortSignal): Promise<HealthReport> {
  const res = await fetch(apiUrl('/health'), { headers: { accept: 'application/json' }, signal });
  // 503 is a valid answer: the API is up and reports a dependency as down.
  if (res.ok || res.status === 503) return (await res.json()) as HealthReport;
  throw new ApiError(res.status);
}

export function useHealth() {
  return useQuery({
    queryKey: statusKeys.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: REFRESH_INTERVAL_MS,
  });
}
