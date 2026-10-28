# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Each phase of the [roadmap](README.md#roadmap) ends with
a release.

## [0.7.0] - 2026-10-28

Phase 4: orders. Purchase and sales orders from the database to the browser, moving goods only
through the warehouse.

### Added

- Purchase orders (`OF`) and sales orders (`OC`): drafts without a number, free to change and to
  delete; confirmation numbers them per company and year, without gaps, and they stop changing.
- Receipts and shipments in parts, each one a stock document recorded in the same transaction as
  the order, which knows its origin and links back to it; undone only from the order.
- Reservations: a confirmed sales order reserves what is available, the rest stays uncovered and is
  reserved later with "Reserve available"; stock lists, items and the overview show reserved and
  available stock, and the reorder point is compared with what is available.
- Closing what is left of an order, cancelling a confirmed order nothing has moved for, duplicating
  an order into a new draft.
- Prices, discount and VAT on order lines; totals with the VAT summary per rate, previewed while a
  draft is typed with the same rounding as the API.
- What suppliers still bring of an item; a purchase order proposed from the items below reorder.
- Permission `orders:fulfil` (warehouse keepers move goods; accountants take orders); the activity
  log shows order events; the demo seed adds orders in every status to the Rossi demo tenant.
- ADR 0024-0026; conventions B34 (across modules), B35, B36.

### Changed

- Free issues, transfers and reversals of a receipt take only available stock: reserved goods stay
  for their order (`STOCK_INSUFFICIENT`). An inventory count below what is reserved is refused
  (`STOCK_RESERVED`).
- `verify-stock` also compares reserved quantities with the reservations.
- An item's "stock managed" is no longer written when the item changes; the database privilege on
  it goes in the next release.

## [0.6.1] - 2026-10-23

### Fixed

- On a desktop, a sidebar collapsed to icons can be opened again: its button stays in the icon
  strip, under the brand (before, only Ctrl+B brought it back).

## [0.6.0] - 2026-10-23

Phase 3: warehouse. Goods in and out of the warehouses of each company, from the database to the
browser, with stock that is always the sum of its movements.

### Added

- Warehouses per company, with a code printed on documents, archived only when empty.
- Stock documents with lines and a reason: opening stock, receipt from a supplier (with the
  supplier's delivery note), return from a customer, issue for sale, internal use, loss, inventory
  adjustment (by count) and transfer between warehouses. Numbered per company, series and year
  without gaps (`CA-2026/0001`); never changed, corrected by one reversal.
- Stock per item and warehouse, never below zero, also with simultaneous requests; stock at a date;
  each item's history with the stock after every movement; reorder levels and the list of items
  below reorder; a warehouse card on the overview.
- Sending the same document twice records it once (the client chooses its id).
- Quantities with the decimals of their unit of measure (pieces are whole).
- Permissions `stock:read`, `stock:write` and `warehouses:manage`; the activity log shows warehouse
  events.
- Terminal command `verify-stock`; the demo seed adds warehouses, a few weeks of documents and
  reorder levels to the Rossi demo tenant.
- ADR 0021-0023; conventions B11, B32, B33, B34, B3 (views).

### Changed

- "Stock managed" no longer changes after an item is created.
- `GET /registry/reference-data` lists units with their decimals.

## [0.5.0] - 2026-10-21

Phase 2c: responsive interface. The app works on desktops, tablets and phones, each with its own
layout, and the menu moves to a sidebar grouped by module.

### Added

- Sidebar grouped by module (registry, administration), which can shrink to icons on a desktop
  (remembered), stays icons only on a tablet and opens as a panel on a phone, together with the
  customer and the company.
- Lists as cards on phones, with the order chosen from a select and filters in a bottom panel;
  secondary columns hidden on tablets.
- On phones: Save and Cancel at the bottom of a record while there are changes, confirmations from
  the bottom, archiving as an icon, 44 px controls.
- Web app manifest with icons, so the app can be added to a home screen (no service worker, no
  offline use).
- Browser tests on a phone and a tablet, with screenshots of the three layouts kept by CI.
- ADR 0020; conventions F20 (replaced), F8 (updated), F22.

### Changed

- The menu is no longer in the top bar; sign-out, account, language and theme are at the bottom of
  the sidebar.

## [0.4.0] - 2026-10-21

Phase 2: registry. Customers, suppliers and items, from the database to the browser.

### Added

- Parties (customers, suppliers or both) of four kinds, private person, sole trader, company and
  organization, each with its required fields; Italian checks for parties in Italy: VAT number and
  tax code with their check characters (omocodia included), postal code, province, SdI recipient
  code. Foreign parties are supported with free identifiers.
- One active party per VAT number in a tenant, with the existing one offered while typing and in
  the `409 PARTY_VAT_TAKEN` answer (`existingId`).
- Items with a code unique regardless of case and never reused or changed, unit of measure, VAT
  code (rates and the natures N1-N7), list price, goods or services.
- Lists with search (trigram indexes), filters, sorting and paging; records archived and restored,
  never deleted; edit conflicts refused with `409 EDIT_CONFLICT`; every change in the audit log with
  the names of the changed fields.
- `GET /registry/reference-data` with VAT codes, units and legal forms.
- Web app: customers and suppliers, items, records in sections with read-only mode, archive and
  restore dialogs, conflict banner, a question before leaving unsaved changes, prices typed and shown
  in the person's language; the activity page links events to their record.
- Demo seed: a registry for both demo tenants; it now adds only what is missing, so it can run on
  an installation that already has the demo.
- ADRs 0017-0019; conventions B1, B19, B29-B31, F7-F9, F20.

### Changed

- Permissions `registry:read` and `registry:write` are replaced by `parties:read/write` and
  `items:read/write`: accountants edit parties, warehouse keepers edit items.
- Company tax codes are checked with their check character.
- Prices and quantities travel in JSON as decimal strings (ADR 0019).

## [0.3.0] - 2026-10-20

Phase 1b: authentication, permissions and audit. People sign in, with two-factor authentication,
and see only what their role allows; every route is closed by default.

### Added

- Activation of an account with its one-time code, password (argon2id) and mandatory TOTP
  two-factor authentication with ten one-time recovery codes; the secret is stored encrypted.
- Sign-in in two steps, the same answer for every refused attempt, lockout after five failures and a
  strict rate limit on sign-in routes.
- Sessions with a 10-minute access token and a rotating refresh token in an `HttpOnly`,
  `SameSite=Strict` cookie; reuse of an old refresh token closes the session. Sign-out from one or
  every device; password change; new recovery codes.
- Choice of the tenant after sign-in and at any time; the company from the `X-Company-Id` header,
  verified on every request.
- Authorization: routes closed by default (`@Public()` for the exceptions), permissions from roles
  (`@RequiresPermission`), company guard (`@RequiresCompany`).
- Audit log: security events of each person (`/auth/events`) and events of each tenant
  (`/audit-events`, administrators), append-only by database trigger. Terminal commands record their
  changes.
- Terminal commands: `issue-code` on an active account is a recovery; `revoke-sessions`; `seed-demo`
  gives demo people a known password and authenticator secret outside production.
- Web app: sign-in, two-factor step, activation with QR code, recovery codes, choice of customer and
  company, overview, account page, activity page; shared form, table and error components.
- OpenAPI document (`pnpm openapi`) and web client types generated from it, checked in CI.
- Browser test of the whole sign-in flow with Playwright, in CI.
- ADRs 0012-0016.

### Changed

- The status page moved to `/status`; `/` is the signed-in overview.
- API responses are sent with `Cache-Control: no-store`.
- Production needs `AUTH_JWT_SECRET` and `MFA_ENCRYPTION_KEY`; the Compose file passes them to the
  API and to the terminal commands.

## [0.2.0] - 2026-10-20

Phase 1a: tenancy and identity. The multi-tenant foundations every later phase builds on, with
isolation enforced by the database. No sign-in yet: it arrives with phase 1b.

### Added

- Data model for tenants, companies, enabled modules, people, memberships and one-time activation
  codes; Prisma schema split per module.
- PostgreSQL Row-Level Security on every tenant table through one standard function, composite
  foreign keys that cannot cross tenants, and a guard test that fails if a tenant table lacks
  protection.
- `TenantDatabase` and `TenantContextService`: tenant work runs in one transaction with the tenant
  context set for the database.
- `tenancy` module: module catalog with dependencies, Italian VAT numbers with check digit, and the
  `@RequiresModule` guard (`403 MODULE_NOT_ENABLED`).
- `identity` module: one identity per person across tenants, memberships with role and reachable
  companies, activation codes stored as hashes.
- Terminal commands (`pnpm cli`, Compose service `cli`): `create-tenant`, `add-company`, `add-user`,
  `remove-user`, `set-modules`, `issue-code`, `list-tenants`, and `seed-demo` with two fictitious
  tenants.
- RFC 9457 Problem Details for every error, with validation errors per field.
- Module boundary check in CI (`pnpm check:boundaries`).
- Status page: tenant isolation check. `/health` reports `checks.tenantIsolation`.
- ADRs 0008-0011.

### Changed

- The API connects as the `mercurio_app` database role, subject to Row-Level Security; migrations,
  commands and seeds use the owner role through `DATABASE_ADMIN_URL`. In production the API refuses
  to start with a role that could bypass Row-Level Security.
- Unknown API routes answer `application/problem+json` with code `NOT_FOUND`.

### Upgrade notes

- Add `POSTGRES_APP_PASSWORD` to `.env.production` and update `docker-compose.prod.yml` on the
  server **before** deploying: Compose refuses to start without it.

## [0.1.0] - 2026-10-19

Phase 0: walking skeleton. The full path from code to production works end to end, with no business
features yet.

### Added

- pnpm monorepo with a NestJS 12 API (`apps/api`) and a React 19 + Vite web app (`apps/web`).
- `GET /api/health`, reporting the API version, uptime and database reachability (`503` when the
  database does not answer within two seconds).
- Status page showing the health report, refreshed every 15 seconds.
- Light, dark and system themes; Italian and English interface.
- Design tokens for the amethyst and amber palette, Geist fonts bundled with the app.
- Configuration validated at startup, configurable base path (`APP_BASE_PATH`).
- Structured logs with a correlation id per request, security headers, global rate limit.
- PostgreSQL 17 with Prisma 7.
- Docker image (multi-stage, non-root) serving the API and the web app, Docker Compose for
  development and production, nginx location, deployment script.
- Quality tooling: Vitest, Testing Library, oxlint, Prettier, Husky, lint-staged, commitlint.
- GitHub Actions CI: format, type check, lint, unit and end-to-end tests, build, Docker image.
- Continuous delivery: CI publishes the images to GitHub Container Registry, a version tag deploys
  them over SSH with a key restricted to the deployment script, any version can be redeployed by
  hand.
- Documentation: architecture, conventions, glossary, first architecture decision records.

[0.7.0]: https://github.com/MicheleG14/mercurio/releases/tag/v0.7.0
[0.6.1]: https://github.com/MicheleG14/mercurio/releases/tag/v0.6.1
[0.6.0]: https://github.com/MicheleG14/mercurio/releases/tag/v0.6.0
[0.5.0]: https://github.com/MicheleG14/mercurio/releases/tag/v0.5.0
[0.4.0]: https://github.com/MicheleG14/mercurio/releases/tag/v0.4.0
[0.3.0]: https://github.com/MicheleG14/mercurio/releases/tag/v0.3.0
[0.2.0]: https://github.com/MicheleG14/mercurio/releases/tag/v0.2.0
[0.1.0]: https://github.com/MicheleG14/mercurio/releases/tag/v0.1.0
