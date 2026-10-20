import { randomBytes } from 'node:crypto';
import { sha256Hex } from './hash.js';

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32: no 0, 1, 8, 9 to confuse

/** 10 bytes = 80 random bits, written as 16 base32 characters: ABCD-EFGH-IJKL-MNOP. */
function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join('-');
}

/** What the person types may have spaces, dashes or lowercase: only the characters count. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function hashRecoveryCode(input: string): string {
  return sha256Hex(normalizeRecoveryCode(input));
}

/** A fresh set: the codes to show once, and the hashes to store. */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = Array.from({ length: count }, newRecoveryCode);
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** The two kinds of code the sign-in accepts: six digits (TOTP) or a recovery code. */
export function isTotpFormat(input: string): boolean {
  return /^\d{6}$/.test(input.trim());
}
