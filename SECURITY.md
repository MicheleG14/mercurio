# Security policy

## Supported versions

Only the latest version on the `main` branch receives fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub:
**Security** tab of this repository → **Report a vulnerability**.

Include what you found, how to reproduce it and what impact you expect. You will get an
acknowledgement within a week; once the issue is fixed, you will be credited in the changelog unless
you prefer otherwise.

## Scope

Mercurio is a portfolio project and contains only fictitious data. Reports are still valuable,
especially about:

- authentication, two-factor authentication and session handling;
- authorisation (actions or data available to the wrong role);
- injection, cross-site scripting, request forgery;
- leaks of secrets or personal data in logs, responses or images.

## Measures in place

- Security headers (helmet), a global rate limit, single origin (no CORS).
- Input validated on every request, unknown fields rejected.
- Configuration validated at startup; secrets only in environment files outside the repository.
- Credentials and cookies redacted from logs.
- Containers run as non-root, with a read-only filesystem and no Linux capabilities; the database is
  not exposed.
- Dependencies monitored by Dependabot.

Planned with the authentication phase: argon2id password hashing, TOTP two-factor authentication with
one-time recovery codes, `HttpOnly` refresh-token cookies, stricter rate limiting and temporary
lockout on sign-in, roles and an audit log.
