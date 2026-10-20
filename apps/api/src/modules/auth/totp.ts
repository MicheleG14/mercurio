import { Secret, TOTP } from 'otpauth';

export const TOTP_PERIOD_SECONDS = 30;
const ISSUER = 'Mercurio';

function totpFor(secretBase32: string, label = 'account'): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1', // the only algorithm every authenticator app supports
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** A new 160-bit secret, in base32 (what authenticator apps and QR codes use). */
export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/** The `otpauth://` address the QR code encodes. */
export function totpUri(secretBase32: string, accountEmail: string): string {
  return totpFor(secretBase32, accountEmail).toString();
}

/** The code an authenticator would show at this moment (used by tests and the demo seed). */
export function totpCode(secretBase32: string, at = Date.now()): string {
  return totpFor(secretBase32).generate({ timestamp: at });
}

/**
 * Checks a code allowing one step either side (clock drift of up to 30 seconds). Returns the
 * step number that matched, or null. A step at or before `lastStep` is refused: a code can be
 * used only once, so a stolen or observed code is worthless a moment later.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  lastStep: bigint | number | null,
  at = Date.now(),
): number | null {
  const delta = totpFor(secretBase32).validate({ token: code, window: 1, timestamp: at });
  if (delta === null) return null;
  const step = Math.floor(at / 1000 / TOTP_PERIOD_SECONDS) + delta;
  return lastStep !== null && step <= Number(lastStep) ? null : step;
}
