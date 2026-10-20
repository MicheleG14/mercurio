import createClient from 'openapi-fetch';
import type { paths } from '@/api/schema';
import { API_BASE_URL, ApiError, type ProblemDetails } from '@/lib/api';

/**
 * The typed client of the API, generated from its OpenAPI description (docs/adr/0016): calling
 * a route that does not exist, or with the wrong body, fails to compile. Sign-in state and the
 * company header are added by middleware registered by the auth feature, so this file knows
 * nothing about them (a feature does not import another feature).
 */
export const api = createClient<paths>({
  // openapi-fetch builds absolute requests; the path is relative to the page's own origin.
  baseUrl: `${window.location.origin}${API_BASE_URL}`,
  // The refresh cookie travels with same-origin requests.
  credentials: 'same-origin',
  // Resolved at every call rather than captured once, so tests can replace fetch.
  fetch: (request) => globalThis.fetch(request),
});

/**
 * Unwraps a client response: the data on success, an ApiError (with the Problem Details body)
 * otherwise. Every query and mutation goes through this, so errors have one shape (F13).
 */
export async function unwrap<T>(
  result: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await result;
  if (response.ok) return data as T;
  const problem = isProblem(error) ? error : undefined;
  throw new ApiError(response.status, problem);
}

function isProblem(value: unknown): value is ProblemDetails {
  return typeof value === 'object' && value !== null && 'code' in value;
}
