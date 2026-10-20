import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContextService } from '../../prisma/index.js';
import { AuthContextService } from './auth-context.js';
import { AuthService } from './auth.service.js';
import { setAuthFailure } from './request-state.js';
import { TokenService } from './tokens.js';

/**
 * Establishes who is calling, before any guard runs. With a valid access token it checks the
 * session, person, tenant and membership against the database (AuthService.resolveIdentity) and
 * runs the rest of the request inside the resulting context: the tenant context for
 * TenantDatabase, and the auth context for the guards. The tenant always comes from the verified
 * token, never from anything else the client sends (S5).
 *
 * It never refuses a request itself: it records why a token was rejected and lets the guard
 * decide, because a public route must still work when a stale token is attached.
 */
@Injectable()
export class AuthenticationMiddleware implements NestMiddleware {
  constructor(
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly authContext: AuthContextService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers.authorization;
    if (!header) return next();

    const [scheme, token] = header.split(' ');
    const claims =
      scheme?.toLowerCase() === 'bearer' && token
        ? await this.tokens.verify('access', token)
        : null;
    if (!claims) {
      setAuthFailure(req, { status: 401, code: 'UNAUTHORIZED' });
      return next();
    }

    // An unexpected failure here (database unreachable) reaches the global filter and becomes a
    // generic 500 in Problem Details: see the route inventory tests.
    const resolved = await this.auth.resolveIdentity(claims, req.header('x-company-id'));
    if (!resolved.ok) {
      setAuthFailure(req, { status: resolved.status, code: resolved.code });
      return next();
    }

    const { context } = resolved;
    const proceed = () => this.authContext.run(context, () => next());
    if (context.tenantId) {
      this.tenantContext.run(
        { tenantId: context.tenantId, userId: context.userId, companyId: context.companyId },
        proceed,
      );
    } else {
      proceed();
    }
  }
}
