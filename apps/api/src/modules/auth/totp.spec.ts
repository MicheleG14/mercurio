import { Secret } from 'otpauth';
import { newTotpSecret, totpCode, totpUri, verifyTotp } from './totp.js';

// RFC 6238, Appendix B: SHA-1 test vectors. The secret is the ASCII text "12345678901234567890".
const RFC_SECRET = Secret.fromUTF8('12345678901234567890').base32;
const rfc = (seconds: number) => totpCode(RFC_SECRET, seconds * 1000);

describe('TOTP', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC 6238 vector at %i seconds', (seconds, expected) => {
    // The RFC lists 8 digits; the last 6 are the 6-digit code.
    expect(rfc(seconds)).toBe(expected);
  });

  it('accepts the current code and the neighbouring steps, not the ones further away', () => {
    const at = 1_700_000_000_000;
    const secret = newTotpSecret();

    expect(verifyTotp(secret, totpCode(secret, at), null, at)).not.toBeNull();
    expect(verifyTotp(secret, totpCode(secret, at - 30_000), null, at)).not.toBeNull();
    expect(verifyTotp(secret, totpCode(secret, at + 30_000), null, at)).not.toBeNull();
    expect(verifyTotp(secret, totpCode(secret, at - 90_000), null, at)).toBeNull();
    expect(verifyTotp(secret, '000000x', null, at)).toBeNull();
  });

  it('refuses a step that was already used', () => {
    const at = 1_700_000_000_000;
    const secret = newTotpSecret();
    const code = totpCode(secret, at);

    const step = verifyTotp(secret, code, null, at)!;
    expect(verifyTotp(secret, code, step, at)).toBeNull();
    // A later step is fine.
    expect(verifyTotp(secret, totpCode(secret, at + 30_000), step, at + 30_000)).not.toBeNull();
  });

  it('builds the address a QR code encodes', () => {
    const uri = totpUri('JBSWY3DPEHPK3PXP', 'mario@example.com');

    expect(uri).toMatch(/^otpauth:\/\/totp\/Mercurio:mario%40example\.com\?/);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
  });
});
