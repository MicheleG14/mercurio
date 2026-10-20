import {
  hashRecoveryCode,
  isTotpFormat,
  newRecoveryCodes,
  normalizeRecoveryCode,
} from './recovery-codes.js';

describe('recovery codes', () => {
  it('makes ten distinct codes of 16 characters with their hashes', () => {
    const { codes, hashes } = newRecoveryCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^([A-Z2-7]{4}-){3}[A-Z2-7]{4}$/);
    expect(hashes).toEqual(codes.map(hashRecoveryCode));
  });

  it('ignores case, spaces and dashes when typed', () => {
    expect(normalizeRecoveryCode(' abcd-efgh ijkl-mnop ')).toBe('ABCDEFGHIJKLMNOP');
    expect(hashRecoveryCode('abcd efgh ijkl mnop')).toBe(hashRecoveryCode('ABCD-EFGH-IJKL-MNOP'));
  });

  it('tells a six-digit code from a recovery code', () => {
    expect(isTotpFormat('123456')).toBe(true);
    expect(isTotpFormat(' 123456 ')).toBe(true);
    expect(isTotpFormat('ABCD-EFGH-IJKL-MNOP')).toBe(false);
    expect(isTotpFormat('12345')).toBe(false);
  });
});
