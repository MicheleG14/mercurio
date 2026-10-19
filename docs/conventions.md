# Conventions

The rules the code follows. Each rule has a stable identifier (G = general, B = backend,
F = frontend) that code comments can cite. Only adopted rules are listed: new ones are added when a
phase of the project needs them, and the reasoning behind the larger ones is in [`adr/`](adr/).

## General

| #   | Rule                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Code, comments, commit messages, API and documentation are in **English**.                                                                                                                                 |
| G2  | The interface is in **Italian and English**, and more languages can be added with translation files only. Default language: the browser's; the user's choice is remembered. No literal text in components. |
| G2a | The backend sends **codes, never user-facing text**. Enum values in the database and the API are neutral codes (`DRAFT`, `ISSUED`). See [ADR 0005](adr/0005-translations-in-frontend.md).                  |
| G3  | Domain terms follow the [glossary](glossary.md), in code and in the interface.                                                                                                                             |
| G4  | Commit messages follow **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`, `build:`), checked by a commit hook.                                                     |
| G6  | Every non-obvious architectural decision gets an **ADR** in [`adr/`](adr/), in the same commit as the change.                                                                                              |
| G7  | **Prettier** formats everything, **oxlint** lints both apps, TypeScript runs with `strict: true`. See [ADR 0006](adr/0006-vitest-and-oxlint.md).                                                           |

## Backend

| #   | Rule                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2  | Inside a module: **controller** (HTTP only) → **service** (use cases, rules, transactions) → **repository** (data access). Controllers hold no logic; services know nothing about HTTP.                                                                       |
| B3  | A module never imports another module's internals and never reads its tables: it uses an exported **public service** or **domain events**. See [ADR 0001](adr/0001-modular-monolith.md).                                                                      |
| B8  | Money is **decimal**, never `number`: amounts `numeric(14,2)`, unit prices `numeric(14,4)`, quantities `numeric(14,3)`, arithmetic through one `Money` type, VAT computed on the total taxable amount per rate. See [ADR 0002](adr/0002-money-as-decimal.md). |
| B17 | Errors are **RFC 9457 Problem Details** with a stable `code` and per-field `errors`, produced by one exception filter. See [ADR 0003](adr/0003-problem-details-errors.md).                                                                                    |
| B20 | Unit tests for logic; **end-to-end tests against a real PostgreSQL** for flows. The database is not mocked for transactional logic.                                                                                                                           |
| B22 | Logs are structured JSON (**pino**) with a **correlation id** per request. Passwords, tokens, cookies and MFA codes are never logged.                                                                                                                         |
| B23 | Environment variables are **validated at startup**; the application refuses to start if any is missing or invalid.                                                                                                                                            |
| B24 | **helmet** security headers, a global **rate limit** (stricter on sign-in), no CORS (single origin), dependencies monitored by **Dependabot**.                                                                                                                |

## Frontend

| #   | Rule                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Colours are **semantic CSS tokens** in OKLCH (`--background`, `--primary`, `--muted`, `--destructive`…), defined for light and dark. Components use tokens only, never literal colours such as `bg-blue-500`.                                      |
| F2  | Palette **amethyst and amber**: violet primary (OKLCH hue 298), amber highlight (hue 80), neutrals slightly tinted violet. Amber is for backgrounds, avatars and highlights, not for text.                                                         |
| F3  | Status colours (success, warning, error, info) are tokens of their own, with light and dark pairs checked for contrast.                                                                                                                            |
| F4  | Theme by **class** (`.dark`): follows the system by default, three-state switch (system, light, dark) remembered in `localStorage`, no flash on load.                                                                                              |
| F6  | Fonts **Geist** (text) and **Geist Mono** (codes and identifiers), weights 400/500/600, bundled with the app. Tabular figures for amounts and tables.                                                                                              |
| F10 | Numbers and dates are formatted **only by shared helpers** based on `Intl` and the user's locale; components never format directly.                                                                                                                |
| F11 | Code is organised **by feature** (`features/<name>`), with `components/ui` (shadcn/ui primitives), `components/shared` (reusable components) and `lib`. A feature does not import from another feature.                                            |
| F21 | Translations with **react-i18next**: one JSON file per language and area (`locales/<lang>/<area>.json`), English keys by feature. A test checks that all languages have the same keys. Plurals and variables via the library, never concatenation. |
