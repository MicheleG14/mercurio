/**
 * Base URL of the API. The web app and the API share the same origin and base path
 * (e.g. /mercurio/ and /mercurio/api), so no CORS is involved. BASE_URL always ends with "/".
 */
export const API_BASE_URL = `${import.meta.env.BASE_URL}api`;

/** Error body of every failed API call (RFC 9457 Problem Details, docs/adr/0003). */
export interface ProblemDetails {
  status: number;
  code: string;
  title?: string;
  detail?: string;
  errors?: { field: string; code: string }[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem?: ProblemDetails;

  constructor(status: number, problem?: ProblemDetails) {
    super(problem?.title ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
