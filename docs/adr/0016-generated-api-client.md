# 0016. API contract: OpenAPI document and generated client types

- Status: Accepted
- Date: 2026-10-20

## Context

The web app calls the API. Hand-written types drift from the real API without anyone noticing until
a screen breaks at runtime.

## Decision

- The API describes itself with OpenAPI from its DTOs (`@nestjs/swagger`). `pnpm openapi` writes the
  document to `apps/api/openapi.json` without a database, with machine-independent settings.
- The web app's types are generated from it with **openapi-typescript** into
  `apps/web/src/api/schema.d.ts`; calls go through **openapi-fetch**, a thin typed `fetch`. Both files
  are committed, and CI regenerates them and fails if they differ.
- Authentication (token, refresh on `401`, company header) is a middleware of the client, so screens
  never handle it.

## Consequences

- Calling a route that does not exist, or with the wrong body, does not compile.
- Changing an API DTO requires running `pnpm openapi` and committing the result.
- Error bodies are not described per route; they all follow Problem Details (ADR 0003).

## Alternatives considered

- **A full client generator** (functions per operation): more generated code to review, for little
  gain over typed paths.
- **Shared TypeScript types between the two apps**: would couple the web app to backend internals
  and bypass what the API really exposes.
