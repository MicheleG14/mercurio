# Mercurio

**Warehouse and invoicing ERP**

[![CI](https://github.com/MicheleG14/mercurio/actions/workflows/ci.yml/badge.svg)](https://github.com/MicheleG14/mercurio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A vertical ERP for warehouse and invoicing, built as a modular monolith with NestJS and React.
Named after Mercury, the Roman god of commerce.

> **Status: phase 4.** People sign in with mandatory two-factor authentication and work from a
> desktop, a tablet or a phone on the registry (customers, suppliers and items, with Italian tax
> checks), on the warehouse (documents that are never changed, only reversed; stock computed from
> the movements and never below zero, even with simultaneous requests; reorder levels) and on
> orders: purchase orders received in parts, sales orders that reserve the goods available and are
> shipped in parts, with prices and VAT. Every change is in the activity log. Every phase ships a complete vertical slice (database → API → UI) to
> production. See the [roadmap](#roadmap).

## What it will do

- **Multi-tenant**: several customers on one installation, each with one or more companies and only
  the modules it bought; one identity per person across customers. Isolation is enforced by the
  database, not only by the code.
- **Registry**: customers and suppliers as one party with roles and four kinds (private person, sole
  trader, company, organization), Italian VAT number and tax code checks, items with codes that are
  never reused, VAT codes with the natures of the e-invoice.
- **Warehouse**: warehouses per company; stock documents (receipt from a supplier, issue, inventory
  count, transfer) numbered without gaps and corrected only by a reversal; stock computed from the
  movements, never edited by hand and never below zero; stock at a date, item history, reorder
  levels.
- **Orders**: purchase orders received in parts and sales orders shipped in parts, each receipt or
  shipment a stock document in the same transaction; sales orders reserve what is available, so no
  free issue takes promised goods; prices, discount and VAT on the lines, totals rounded once; a
  purchase order proposed from the items below reorder.
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
- **Tenant isolation**: shared database with Row-Level Security on every tenant table; the API runs
  as a role that cannot bypass it, and a test fails if a new table lacks protection.
- **Module boundaries** are checked in CI: a module offers others only what its `index.ts` exports,
  and in SQL only the read-only views it publishes.
- **Consistency under concurrency**: stock documents lock the rows they touch in a fixed order, so
  two people taking out the last pieces at once cannot push stock below zero, and numbering has no
  gaps; the client chooses a document's id, so a repeated request records it once. Orders keep the
  same order of locks across the two modules: an order and its stock document are one transaction,
  and the database refuses to promise the same goods twice.
- **Closed by default**: every API route needs a signed-in person unless it is explicitly public;
  permissions come from roles and are checked on every request, together with the enabled modules
  and the company.
- **Sessions**: a short-lived access token in memory and a rotating refresh token in an `HttpOnly`
  cookie; reusing an old refresh token closes the session.
- **Typed API contract**: the web client's types are generated from the API's OpenAPI document, and
  CI fails if they are out of date. Prices travel as decimal strings, never JSON numbers.
- **Responsive**: one layout per screen size (sidebar on desktops, icons on tablets, a panel and
  cards on phones), every screen usable on a phone.
- **Edit conflicts and archiving**: records carry a version, so a change based on an old one is
  refused instead of overwriting someone else's; records are archived, never deleted.

## Documentation

- [Architecture](docs/architecture.md): runtime, data model and tenant isolation, modules, request lifecycle
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
pnpm db:setup                    # migrations, then the login of the API's database role
pnpm seed:demo                   # optional: two fictitious tenants with their registry (see below)

pnpm dev:api                     # API on http://127.0.0.1:3000/api (docs at /api/docs)
pnpm dev:web                     # web app on http://127.0.0.1:5173
```

The demo people (for example `anna.rossi@example.com`, see `apps/api/src/cli/seed-demo.ts`) sign in
with the password `Demo-password-2026` and the authenticator secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`:
add it to any authenticator app to get the codes. These credentials exist only outside production.

| Command                                    | What it does                                       |
| ------------------------------------------ | -------------------------------------------------- |
| `pnpm test` / `pnpm test:e2e`              | Unit tests / API end-to-end tests                  |
| `pnpm --filter @mercurio/web test:browser` | Browser tests: sign-in, registry, phone and tablet |
| `pnpm lint` / `pnpm typecheck`             | Static checks                                      |
| `pnpm check:boundaries`                    | Module boundary check                              |
| `pnpm openapi`                             | Regenerate the OpenAPI document and client types   |
| `pnpm cli <command>`                       | Terminal commands (tenants, people, recovery)      |
| `pnpm format`                              | Format the whole repository                        |
| `pnpm build`                               | Production build of both apps                      |

## Production

The app runs in Docker behind nginx under the `/mercurio` path. CI publishes the images to GitHub
Container Registry, and pushing a version tag deploys it:

```bash
git tag v0.1.0 && git push origin v0.1.0   # build, publish, deploy
```

On the server, the deployment folder holds only `docker-compose.prod.yml`, `deploy/deploy.sh` and
`.env.production` (from `.env.production.example`, with real passwords and secrets). The script pulls the
images, runs the migrations, restarts the app and waits for the health check. Any published version
can be redeployed by hand from the **Deploy** workflow, which is also the rollback.

The API connects as the `mercurio_app` database role, whose password (`POSTGRES_APP_PASSWORD`)
lives in `.env.production` next to the owner's. Tenants and people are created with terminal
commands, which run as the owner and are never exposed over HTTP:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm cli create-tenant \
  --name "…" --slug … --modules all --company-name "…" --vat … --admin-email … --admin-name "…"
```

`create-tenant` and `add-user` print a one-time activation code for each new person. The person opens
`<address>/mercurio/activate#<code>`, chooses a password, sets up an authenticator app and saves the
recovery codes. There is no email reset: to recover an account, the operator issues a new code
(`issue-code --email …`), which resets password and two-factor setup when used; `revoke-sessions`
signs a person out everywhere.

`deploy/nginx/mercurio.conf` holds the nginx locations; the container listens on `127.0.0.1:8001` only
and the database is not exposed. Details in [ADR 0007](docs/adr/0007-continuous-delivery-github-actions.md).

## Roadmap

| Phase | Content                                                          | Status |
| ----- | ---------------------------------------------------------------- | ------ |
| 0     | Walking skeleton: monorepo, CI, Docker, status page              | ✅     |
| 1a    | Tenancy: tenants, companies, people, modules, Row-Level Security | ✅     |
| 1b    | Authentication: sign-in, TOTP two-factor, roles, audit log       | ✅     |
| 2     | Registry: customers, suppliers, items                            | ✅     |
| 2c    | Responsive interface: sidebar, layouts for tablet and phone      | ✅     |
| 3     | Warehouse: movements, stock levels, goods receipt                | ✅     |
| 4     | Orders: purchase and sales orders, reservations, concurrency     | ✅     |
| 5     | Invoicing: invoices, credit notes, due dates, PDF                |        |
| 6     | Polish: dashboard, architecture decision records, seed data      |        |

## Out of scope, by choice

- Rules of other countries and other currencies: Mercurio follows Italian tax rules and works in
  euro. Foreign customers and suppliers are supported; amounts in another currency are converted by
  hand ([ADR 0017](docs/adr/0017-italian-rules-euro-only.md)).
- Self-service sign-up, subscriptions and billing, one subdomain per customer: tenants are created
  with terminal commands ([ADR 0010](docs/adr/0010-identity-and-memberships.md)).
- General ledger, production planning, purchase invoices.
- Stock valuation (average cost, FIFO), lots, serial numbers, locations and barcodes.
- Quotes, price lists per customer, cascading discounts, reserving goods still incoming, automatic
  reordering: orders cover what is ordered, reserved and moved.
- Transmission to the Italian e-invoicing exchange (SdI); at most, generating the FatturaPA XML.

## License

[MIT](LICENSE) © Michele Ginolfi
