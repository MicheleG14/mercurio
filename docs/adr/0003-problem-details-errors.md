# 0003. Errors as RFC 9457 Problem Details with codes

- Status: Accepted
- Date: 2026-10-19

## Context

The web app must show precise, translated messages ("not enough stock", "invoice already issued")
and attach validation errors to the right form fields. Without a contract, every endpoint invents its
own error shape and the frontend ends up parsing message strings.

## Decision

Every error response follows **RFC 9457 (Problem Details for HTTP APIs)**, served as
`application/problem+json`, extended with:

- `code`: a stable, machine-readable application code (e.g. `STOCK_INSUFFICIENT`);
- `errors`: for validation failures, a list of `{ field, code }`.

```json
{
  "type": "about:blank",
  "status": 409,
  "title": "Conflict",
  "code": "STOCK_INSUFFICIENT",
  "errors": [{ "field": "lines[0].quantity", "code": "EXCEEDS_AVAILABLE" }]
}
```

Domain exceptions are mapped to this format by a single exception filter. The backend does not
decide user-facing wording: the frontend translates the `code` (see
[0005](0005-translations-in-frontend.md)).

## Consequences

- One error shape for every endpoint, described once in OpenAPI and typed once in the frontend.
- Codes are part of the public API contract: renaming one is a breaking change.
- `title` and `detail` are for developers and logs, never shown as-is to users.

## Alternatives considered

- **NestJS default error body**: no stable code, and the message is free text.
- **A custom error format**: works, but a standard is recognised by tools and by other developers.
