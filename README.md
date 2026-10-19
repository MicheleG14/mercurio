# Mercurio

**Warehouse and invoicing ERP**

[![CI](https://github.com/MicheleG14/mercurio/actions/workflows/ci.yml/badge.svg)](https://github.com/MicheleG14/mercurio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A vertical ERP for warehouse and invoicing, built as a modular monolith with NestJS and React.
Named after Mercury, the Roman god of commerce.

> **Status: phase 0 of 6.** The walking skeleton is in place: the full path from code to production
> (CI, Docker, reverse proxy) works end to end, and every following phase ships a complete vertical
> slice (database → API → UI). See the [roadmap](#roadmap).

## What it will do

- **Warehouse**: stock movements, stock levels computed from movements (never edited by hand),
  goods receipt, reorder thresholds.
- **Orders**: purchase and sales orders, partial fulfilment, stock reservation, safe concurrency.
- **Invoicing**: invoices generated from fulfilled orders through domain events, gap-free numbering,
  immutable issued documents corrected only by credit notes, VAT summary per rate, PDF.
- **Security**: sign-in with TOTP two-factor authentication, roles, audit log.

## Stack

| Layer    | Choice                                                                  |
| -------- | ----------------------------------------------------------------------- |
| Backend  | NestJS 12, TypeScript (strict), class-validator, pino                   |
| Database | PostgreSQL 17, Prisma 7                                                 |
| Frontend | React 19, Vite 8, Tailwind CSS 4, shadcn/ui (Base UI), TanStack Query   |
| i18n     | react-i18next: Italian and English, more languages without code changes |
| Quality  | Vitest, Testing Library, oxlint, Prettier, Husky, commitlint            |
| Delivery | Docker (multi-stage, non-root), Docker Compose, GitHub Actions, nginx   |

## Architecture in brief

- **Modular monolith**: one deployable, one module per business area. Modules never import each
  other's internals; they talk through public services or domain events.
- **Layers inside a module**: controller (HTTP only) → service (business rules, transactions) →
  repository (data access).
- **Money** is never a JavaScript `number`: PostgreSQL `numeric` and a single `Money` type.
- **Errors** follow RFC 9457 (Problem Details) with stable codes; the UI translates the codes.
- **One origin**: the API serves the built web app, so there is no CORS and cookies stay simple.

## Documentation

- [Architecture](docs/architecture.md): runtime, modules, request lifecycle, configuration
- [Conventions](docs/conventions.md): the rules the code follows
- [Glossary](docs/glossary.md): domain terms, English ↔ Italian
- [Architecture decision records](docs/adr/)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## Run it locally

Requirements: Node.js 24 (see `.node-version`), pnpm (via `corepack enable`), Docker.

```bash
cp .env.example .env
docker compose up -d db          # PostgreSQL on 127.0.0.1:5432
pnpm install
pnpm generate                    # Prisma client

pnpm dev:api                     # API on http://127.0.0.1:3000/api (docs at /api/docs)
pnpm dev:web                     # web app on http://127.0.0.1:5173
```

| Command                        | What it does                      |
| ------------------------------ | --------------------------------- |
| `pnpm test` / `pnpm test:e2e`  | Unit tests / API end-to-end tests |
| `pnpm lint` / `pnpm typecheck` | Static checks                     |
| `pnpm format`                  | Format the whole repository       |
| `pnpm build`                   | Production build of both apps     |

## Production

The app runs in Docker behind nginx under the `/mercurio` path. CI publishes the images to GitHub
Container Registry, and pushing a version tag deploys it:

```bash
git tag v0.1.0 && git push origin v0.1.0   # build, publish, deploy
```

On the server, the deployment folder holds only `docker-compose.prod.yml`, `deploy/deploy.sh` and
`.env.production` (from `.env.production.example`, with a real password). The script pulls the
images, runs the migrations, restarts the app and waits for the health check. Any published version
can be redeployed by hand from the **Deploy** workflow, which is also the rollback.

`deploy/nginx/mercurio.conf` holds the nginx locations; the container listens on `127.0.0.1:8001` only
and the database is not exposed. Details in [ADR 0007](docs/adr/0007-continuous-delivery-github-actions.md).

## Roadmap

| Phase | Content                                                      | Status |
| ----- | ------------------------------------------------------------ | ------ |
| 0     | Walking skeleton: monorepo, CI, Docker, status page          | ✅     |
| 1     | Authentication: sign-in, TOTP two-factor, roles, audit log   |        |
| 2     | Registry: customers, suppliers, items                        |        |
| 3     | Warehouse: movements, stock levels, goods receipt            |        |
| 4     | Orders: purchase and sales orders, reservations, concurrency |        |
| 5     | Invoicing: invoices, credit notes, due dates, PDF            |        |
| 6     | Polish: dashboard, architecture decision records, seed data  |        |

## License

[MIT](LICENSE) © Michele Ginolfi
