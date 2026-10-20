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
- isolation between tenants (one customer's data visible to, or changeable by, another);
- authorisation (actions or data available to the wrong role);
- injection, cross-site scripting, request forgery;
- leaks of secrets or personal data in logs, responses or images.

## Measures in place

- **Tenant isolation enforced by the database**: PostgreSQL Row-Level Security on every tenant
  table, composite foreign keys that cannot cross tenants, and a test that fails if a new tenant
  table lacks protection ([ADR 0008](docs/adr/0008-multi-tenancy-row-level-security.md)).
- The API runs as a database role that cannot bypass Row-Level Security and has read access only
  where no feature writes yet; in production it refuses to start with a role that could bypass it.
- Tenants and people are created only with terminal commands that use the owner role, never over
  HTTP; one-time activation codes are stored as hashes and unreadable by the API role.
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
