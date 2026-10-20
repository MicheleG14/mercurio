import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../../config/app-config.js';

export const REFRESH_COOKIE = 'mercurio_refresh';

/**
 * The refresh token never reaches JavaScript (HttpOnly), travels only over HTTPS in production,
 * is never sent by another site (SameSite=Strict) and only to the auth routes (Path). The name is
 * specific to Mercurio, so it cannot collide with another app on the same domain.
 */
function options(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: 'strict',
    path: `/${config.apiPrefix}/auth`,
  };
}

export function setRefreshCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...options(config),
    maxAge: config.auth.sessionMaxSeconds * 1000,
  });
}

export function clearRefreshCookie(res: Response, config: AppConfig): void {
  res.clearCookie(REFRESH_COOKIE, options(config));
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
