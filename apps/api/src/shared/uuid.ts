import { randomBytes } from 'node:crypto';

/**
 * A new UUID version 7 (RFC 9562): 48 bits of Unix time in milliseconds, then random bits, so ids
 * sort by creation time like those the database makes (B7). For ids chosen before the row
 * exists: a stock document of the demo seed (B33).
 */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  let time = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
