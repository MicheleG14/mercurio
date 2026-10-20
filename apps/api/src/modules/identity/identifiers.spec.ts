import { hashActivationCode, newActivationCode } from './activation-code.js';
import { normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Anna.Rossi@Example.COM ')).toBe('anna.rossi@example.com');
  });

  it.each(['anna', 'anna@', '@example.com', 'anna rossi@example.com', 'anna@example'])(
    'rejects "%s"',
    (email) => {
      expect(() => normalizeEmail(email)).toThrow(
        expect.objectContaining({ code: 'INVALID_EMAIL' }),
      );
    },
  );
});

describe('activation codes', () => {
  it('creates a long random code, stores only its hash, expires in 7 days', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    const first = newActivationCode(now);
    const second = newActivationCode(now);

    expect(first.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.code).not.toBe(second.code);
    expect(first.hash).toBe(hashActivationCode(first.code));
    expect(first.hash).not.toContain(first.code);
    expect(first.expiresAt.toISOString()).toBe('2026-10-27T10:00:00.000Z');
  });
});
