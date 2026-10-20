import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/**
 * Encrypts a secret that must be read back (the TOTP secret) with AES-256-GCM. The stored text is
 * `v1:` + base64url(iv | tag | ciphertext): the prefix names the format, so the key or the
 * algorithm can change later without guessing what old rows contain. GCM authenticates the data,
 * so a modified value fails to decrypt instead of producing garbage.
 */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')}`;
}

export function decryptSecret(box: string, key: Buffer): string {
  const [version, payload] = box.split(':');
  if (version !== VERSION || !payload) throw new Error('Unknown secret format');
  const data = Buffer.from(payload, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
