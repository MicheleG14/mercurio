import { STATUS_CODES } from 'node:http';

/** One invalid field of a request: where, and a stable code the frontend translates. */
export interface FieldError {
  /** Path of the field in the request body, e.g. `email` or `lines[0].quantity`. */
  field: string;
  code: string;
}

/**
 * Body of every error response (RFC 9457), extended with a stable application `code` and,
 * for validation failures, the list of invalid fields. See docs/adr/0003.
 * `title` and `detail` are for developers and logs: the UI shows a translation of `code`.
 */
export interface ProblemDetails {
  type: 'about:blank';
  status: number;
  title: string;
  code: string;
  detail?: string;
  errors?: FieldError[];
  /**
   * Extension member (RFC 9457 §3.2): on a conflict with an existing resource, its id, so the
   * client can lead to it ("this VAT number belongs to…: open it").
   */
  existingId?: string;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Codes for errors that do not come from a domain rule (unknown route, rate limit…). */
const CODES_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_CONTENT',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

export function codeForStatus(status: number): string {
  return CODES_BY_STATUS[status] ?? `HTTP_${status}`;
}

export function problem(
  status: number,
  code: string,
  extra: Pick<ProblemDetails, 'detail' | 'errors' | 'existingId'> = {},
): ProblemDetails {
  return {
    type: 'about:blank',
    status,
    // With type "about:blank", RFC 9457 asks for the standard HTTP reason phrase as title.
    title: STATUS_CODES[status] ?? 'Error',
    code,
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(extra.errors?.length ? { errors: extra.errors } : {}),
    ...(extra.existingId ? { existingId: extra.existingId } : {}),
  };
}
