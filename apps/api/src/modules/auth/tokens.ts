import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

/**
 * What a signed token may be used for. It is written into the token as its audience, so a token
 * made for one purpose is refused for any other: a challenge cannot open the API, and an access
 * token cannot complete an MFA step.
 */
export type TokenPurpose = 'access' | 'mfa' | 'enroll';

export interface TokenClaims {
  /** The user. */
  sub: string;
  /** The session (access tokens). */
  sid?: string;
  /** The tenant chosen for the session (access tokens), if any. */
  tid?: string;
}

const ISSUER = 'mercurio';

/** Signs and checks the short-lived tokens of the sign-in flow (docs/adr/0012). */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.auth.jwtSecret);
  }

  private lifetime(purpose: TokenPurpose): number {
    return { access: this.config.auth.accessTokenSeconds, mfa: 5 * 60, enroll: 15 * 60 }[purpose];
  }

  sign(purpose: TokenPurpose, claims: TokenClaims, now = new Date()): Promise<string> {
    const issuedAt = Math.floor(now.getTime() / 1000);
    return new SignJWT({ sid: claims.sid, tid: claims.tid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(purpose)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.lifetime(purpose))
      .sign(this.key);
  }

  /** The claims of a valid token of this purpose, or null (expired, tampered, wrong purpose). */
  async verify(
    purpose: TokenPurpose,
    token: string,
    now = new Date(),
  ): Promise<TokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'], // never "none", never another algorithm
        issuer: ISSUER,
        audience: purpose,
        currentDate: now,
      });
      if (typeof payload.sub !== 'string') return null;
      return {
        sub: payload.sub,
        sid: typeof payload.sid === 'string' ? payload.sid : undefined,
        tid: typeof payload.tid === 'string' ? payload.tid : undefined,
      };
    } catch {
      return null;
    }
  }

  get accessTokenSeconds(): number {
    return this.config.auth.accessTokenSeconds;
  }
}
