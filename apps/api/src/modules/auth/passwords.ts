import argon2 from 'argon2';

// OWASP's second recommendation for argon2id: 19 MiB, 2 passes, 1 lane. Light enough for a small
// container, and still costly to attack. The parameters are stored inside every hash, so they
// can be raised later: needsRehash tells when a hash was made with older ones.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed stored hash must not become a 500 that tells an attacker something.
    return false;
  }
}

export function passwordNeedsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the time of a real check when there is nothing to check (unknown email, locked account),
 * so the response time does not reveal whether the account exists.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('mercurio-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}

/**
 * Rules from NIST SP 800-63B: length matters, composition rules do not. Returns the code of the
 * first broken rule, or null.
 */
export function checkPasswordPolicy(
  password: string,
): 'TOO_SHORT' | 'TOO_LONG' | 'TOO_SIMPLE' | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'TOO_SHORT';
  if (password.length > PASSWORD_MAX_LENGTH) return 'TOO_LONG';
  if (new Set(password).size < 4) return 'TOO_SIMPLE';
  return null;
}
