# 0006. Vitest and oxlint

- Status: Accepted
- Date: 2026-10-19

## Context

The monorepo has a NestJS backend and a React + Vite frontend. Both need unit tests, the backend
also needs end-to-end tests against a real database, and both need linting that is fast enough to
run on every commit.

## Decision

- **Vitest** is the single test runner for both apps: unit tests in each app, and API end-to-end
  tests with Supertest against a real PostgreSQL (locally from Docker Compose, in CI as a service
  container). The database is not mocked for transactional logic.
- **oxlint** (with type-aware rules) is the linter for both apps; **Prettier** formats everything.
- Husky runs Prettier and oxlint on staged files before each commit and validates the commit
  message (Conventional Commits). CI runs the full set: format check, type check, lint, tests,
  end-to-end tests, build.

Both tools are the defaults of current NestJS project templates.

## Consequences

- One test API and one configuration style across backend and frontend; Vitest reuses the Vite
  configuration in the web app.
- Linting takes well under a second, so the pre-commit hook does not slow work down.
- oxlint has fewer rules and plugins than ESLint; if a needed rule is missing, ESLint can be added
  for that rule alone.

## Alternatives considered

- **Jest + ESLint**: the long-standing standard, but slower, and Jest needs extra configuration for
  ES modules and TypeScript that Vitest handles natively.
