# 0012. Sessions: short access token, rotating refresh cookie

- Status: Accepted
- Date: 2026-10-20

## Context

After signing in, every request must prove who sends it and for which tenant. The web app and the
API share one origin. A stolen credential should be useful for as little time as possible, and the
server must be able to end a session at once (sign-out, password change, removed member).

Three requests arrive before the person has an identity: sign-in, activation and refreshing a
session. The API's database role sees only the current person's rows (Row-Level Security), so for
these three it cannot look anything up on its own.

## Decision

- **Access token**: a JWT signed with HS256 (`jose`), valid 10 minutes, kept **in memory** by the
  browser (never in storage) and sent as `Authorization: Bearer`. Claims: person (`sub`), session
  (`sid`), chosen tenant (`tid`). Its audience is its purpose: challenge and enrolment tokens have
  other audiences and are refused as access tokens, and the reverse.
- **Refresh token**: 32 random bytes in a cookie `mercurio_refresh`, `HttpOnly`, `Secure` in
  production, `SameSite=Strict`, limited to the path `<base>/api/auth`. The database keeps only its
  SHA-256 hash. Each refresh **rotates** it; when a token that was already rotated comes back, a
  copy is in circulation and **the whole session is closed**.
- **Lifetime**: a session ends after 8 hours without a refresh, or 14 days after it started.
- **Checked on every request**: the session is open, the person and the tenant are active, the
  membership exists. The role is read there, not from the token, so removing a person or changing
  their role takes effect immediately, not when the token expires.
- **The tenant comes from the token only**; the company comes from the `X-Company-Id` header and is
  verified against the membership on every request (ADR 0009).
- **Three SECURITY DEFINER functions** are the only way in for a request without identity:
  `app_find_login_subject` (id and status for an email), `app_activate_account` (redeem a code and set
  the password, atomically) and `app_rotate_session` (rotation and reuse detection). They pin
  `search_path`, return the minimum and are executable by the API role only; a test lists them and
  fails when a new one appears.
- Tabs share the cookie but not the memory: they take turns to refresh (Web Locks API), otherwise two
  simultaneous refreshes would look like a stolen token.

## Consequences

- Requests carry the token in a header, so they are not exposed to cross-site request forgery; the
  only routes that use the cookie are `refresh` and `logout`, protected by `SameSite=Strict`.
- A page reload costs one refresh request (the access token lived in memory).
- Every request reads the session and membership: one transaction with a few indexed queries.
- Reuse is detected one rotation back. An older token is simply unknown: refused, without closing the
  session.
- API responses are sent with `Cache-Control: no-store`.

## Alternatives considered

- **One opaque session cookie for everything**: simpler, but every state-changing route would need
  protection against request forgery.
- **Tokens in `localStorage`**: readable by any script injected into the page.
- **Long-lived access tokens with no server-side check**: removing a person would take effect only
  when their token expired.
