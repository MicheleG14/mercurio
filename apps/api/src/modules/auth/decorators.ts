import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'mercurio:public';
export const REQUIRES_COMPANY = 'mercurio:requiresCompany';
export const STRICT_RATE_LIMIT = 'mercurio:strictRateLimit';

/**
 * Lets a route be called without signing in. Every route is protected by default (docs/adr/0014):
 * a new route needs this decorator to be open, and a test lists the open ones.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * The route works on one company: the request must carry a reachable company in the
 * `X-Company-Id` header (S5). Without it: 400 COMPANY_REQUIRED; with one the person cannot
 * reach: 403 COMPANY_NOT_ACCESSIBLE.
 */
export const RequiresCompany = () => SetMetadata(REQUIRES_COMPANY, true);

/** Applies the stricter rate limit used by sign-in routes (AUTH_RATE_LIMIT_PER_MINUTE). */
export const StrictRateLimit = () => SetMetadata(STRICT_RATE_LIMIT, true);
