import {
  checkPasswordPolicy,
  hashPassword,
  passwordNeedsRehash,
  verifyPassword,
} from './passwords.js';

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse battery');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse batterz')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password here')).not.toBe(
      await hashPassword('same password here'),
    );
  });

  it('treats a malformed stored hash as a failed check, not an error', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever password')).toBe(false);
  });

  it('asks for a new hash when the parameters are older', async () => {
    expect(passwordNeedsRehash(await hashPassword('correct horse battery'))).toBe(false);
    expect(passwordNeedsRehash('$argon2id$v=19$m=4096,t=1,p=1$c29tZXNhbHQ$aGFzaA')).toBe(true);
  });

  it.each([
    ['short', 'TOO_SHORT'],
    ['x'.repeat(129), 'TOO_LONG'],
    ['aaaaaaaaaaaaaaaa', 'TOO_SIMPLE'],
    ['correct horse battery', null],
  ])('checks the policy of %j', (password, expected) => {
    expect(checkPasswordPolicy(password)).toBe(expected);
  });
});
