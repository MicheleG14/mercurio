import { SignJWT } from 'jose';
import { loadConfig } from '../../config/app-config.js';
import { TokenService } from './tokens.js';

const config = loadConfig({
  DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
  AUTH_JWT_SECRET: 'unit-test-secret-0123456789abcdef0123456789',
  MFA_ENCRYPTION_KEY: 'ab'.repeat(32),
});
const tokens = new TokenService(config);
const USER = '0198a000-0000-7000-8000-000000000001';

describe('tokens', () => {
  it('round-trips the claims', async () => {
    const token = await tokens.sign('access', { sub: USER, sid: 's1', tid: 't1' });

    expect(await tokens.verify('access', token)).toEqual({ sub: USER, sid: 's1', tid: 't1' });
  });

  it('refuses a token of another purpose', async () => {
    const challenge = await tokens.sign('mfa', { sub: USER });

    expect(await tokens.verify('access', challenge)).toBeNull();
    expect(await tokens.verify('enroll', challenge)).toBeNull();
    expect(await tokens.verify('mfa', challenge)).not.toBeNull();
  });

  it('refuses an expired token', async () => {
    const past = new Date(Date.now() - 11 * 60 * 1000);
    const token = await tokens.sign('access', { sub: USER }, past);

    expect(await tokens.verify('access', token)).toBeNull();
  });

  it('gives sign-in challenges 5 minutes and enrolment 15', async () => {
    const now = new Date();
    const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
    const mfa = await tokens.sign('mfa', { sub: USER }, now);
    const enroll = await tokens.sign('enroll', { sub: USER }, now);

    expect(await tokens.verify('mfa', mfa, later(4))).not.toBeNull();
    expect(await tokens.verify('mfa', mfa, later(6))).toBeNull();
    expect(await tokens.verify('enroll', enroll, later(14))).not.toBeNull();
    expect(await tokens.verify('enroll', enroll, later(16))).toBeNull();
  });

  it('refuses a tampered token and one signed with another key', async () => {
    const token = await tokens.sign('access', { sub: USER });
    const [header, payload, signature] = token.split('.');
    const forged = new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(USER);
    const otherKey = await forged
      .setIssuer('mercurio')
      .setAudience('access')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('another-secret-0123456789abcdef012345'));

    expect(await tokens.verify('access', `${header}.${payload}x.${signature}`)).toBeNull();
    expect(await tokens.verify('access', otherKey)).toBeNull();
    expect(await tokens.verify('access', 'not-a-token')).toBeNull();
  });

  it('refuses an unsigned token (algorithm "none")', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      sub: USER,
      iss: 'mercurio',
      aud: 'access',
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`;

    expect(await tokens.verify('access', unsigned)).toBeNull();
  });
});
