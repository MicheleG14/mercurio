# Contributing

Mercurio is a personal portfolio project, developed by one person. Issues reporting bugs or
suggesting improvements are welcome; for anything larger than a small fix, please open an issue
before a pull request, so we can agree on the approach first.

## Getting started

Follow [Run it locally](README.md#run-it-locally) in the README. Before opening a pull request, the
same checks as CI must pass:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm check:boundaries
pnpm test
pnpm test:e2e     # needs the database: docker compose up -d db && pnpm db:setup
pnpm build
```

## How the code is written

- Read [docs/architecture.md](docs/architecture.md) and [docs/conventions.md](docs/conventions.md)
  first. Module boundaries (B3) and the money rules (B8) matter most.
- Code, comments and commit messages are in English. User-facing text goes in the translation files
  of **every** language (`apps/web/src/locales/`); a test fails if one is missing a key.
- New behaviour comes with tests: unit tests for logic, end-to-end tests for API flows.
- Comments explain **why**, not what. Public interfaces get TSDoc.
- A backend module lives in `apps/api/src/modules/<module>` and offers other modules only what its
  `index.ts` exports; `pnpm check:boundaries` fails otherwise (B3, [ADR 0011](docs/adr/0011-module-activation-and-boundaries.md)).

## Adding a table with tenant data

1. Add the model to `apps/api/prisma/schema/<module>.prisma` with `tenantId` and, for references to
   other tenant tables, composite relations on `[tenantId, …]`.
2. `pnpm --filter @mercurio/api exec prisma migrate dev --create-only --name <change>`, then append to
   the generated SQL: `SELECT mercurio_enable_tenant_isolation('<table>');` and the `GRANT`s the
   feature needs for `mercurio_app` (and nothing more).
3. Access the table only from the module's repository, through `TenantDatabase`.
4. Add the expected write privileges to the guard test (`test/tenant-tables.e2e-spec.ts`) and an
   isolation test for the new feature. The guard test fails if the protection is missing.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), checked by a
hook:

```
feat(warehouse): compute stock level from movements
fix(api): return 404 for unknown items
docs(adr): record the outbox decision
```

The pre-commit hook formats and lints the staged files. Do not bypass the hooks.

## Documentation

Documentation changes in the same commit as the code it describes:

- an architectural decision gets a new record in [docs/adr/](docs/adr/) (template in its README);
- a new or changed rule goes in [docs/conventions.md](docs/conventions.md);
- a new domain term goes in [docs/glossary.md](docs/glossary.md);
- notable changes go in [CHANGELOG.md](CHANGELOG.md) under the next version.

## Security

Never commit `.env` files, credentials or real personal data: the seed data is fictitious. To report
a vulnerability, see [SECURITY.md](SECURITY.md), not a public issue.
