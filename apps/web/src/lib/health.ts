import { useQuery } from '@tanstack/react-query';
import { ApiError, apiUrl } from './api';

/** Mirrors HealthResponseDto of the API (a public route, outside the generated client). */
export interface HealthReport {
  status: 'ok' | 'degraded';
  /** tenantIsolation is down when the API's database role could bypass Row-Level Security. */
  checks: { database: 'up' | 'down'; tenantIsolation: 'up' | 'down' };
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthReport> {
  const res = await fetch(apiUrl('/health'), { headers: { accept: 'application/json' }, signal });
  // 503 is a valid answer: the API is up and reports a dependency as down.
  if (res.ok || res.status === 503) return (await res.json()) as HealthReport;
  throw new ApiError(res.status);
}

/**
 * The version of the running app, as the API reports it: the same container serves the web app,
 * so it is also the version of what is on screen. Read once; a deploy reloads the page anyway.
 */
export function useAppVersion() {
  return useQuery({
    queryKey: ['app', 'version'] as const,
    queryFn: ({ signal }) => fetchHealth(signal),
    select: (report) => report.version,
    staleTime: Infinity,
  });
}
