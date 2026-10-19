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
pnpm test
pnpm test:e2e     # needs the database: docker compose up -d db
pnpm build
```

## How the code is written

- Read [docs/architecture.md](docs/architecture.md) and [docs/conventions.md](docs/conventions.md)
  first. Module boundaries (B3) and the money rules (B8) matter most.
- Code, comments and commit messages are in English. User-facing text goes in the translation files
  of **every** language (`apps/web/src/locales/`); a test fails if one is missing a key.
- New behaviour comes with tests: unit tests for logic, end-to-end tests for API flows.
- Comments explain **why**, not what. Public interfaces get TSDoc.

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
