import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from './secret-box.js';

const key = randomBytes(32);

describe('secret box', () => {
  it('round-trips a secret', () => {
    const box = encryptSecret('JBSWY3DPEHPK3PXP', key);

    expect(box.startsWith('v1:')).toBe(true);
    expect(box).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(box, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a new nonce every time', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  it('refuses a modified value, another key or an unknown format', () => {
    const box = encryptSecret('secret', key);
    const tampered = `${box.slice(0, -2)}${box.endsWith('AA') ? 'BB' : 'AA'}`;

    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(box, randomBytes(32))).toThrow();
    expect(() => decryptSecret(box.replace('v1:', 'v9:'), key)).toThrow(/format/);
  });
});
