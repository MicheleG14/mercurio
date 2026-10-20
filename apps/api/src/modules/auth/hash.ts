import { createHash, randomBytes } from 'node:crypto';

/**
 * Fast hash for values that are long and random (refresh tokens, recovery codes): unlike a
 * password they cannot be guessed from a list, so a slow hash would add cost without safety.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** A new random token and the hash that is stored in its place. */
export function newOpaqueToken(bytes = 32): { token: string; hash: string } {
  const token = randomBytes(bytes).toString('base64url');
  return { token, hash: sha256Hex(token) };
}
