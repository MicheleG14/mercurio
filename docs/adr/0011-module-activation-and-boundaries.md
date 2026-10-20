# 0011. Modules enabled per tenant, boundaries checked in CI

- Status: Accepted
- Date: 2026-10-20

## Context

Each business area (registry, warehouse, orders, invoicing) should be sellable on its own: a tenant
pays for, and sees, only the modules it bought. The code must keep those areas apart so that this
stays true as the project grows ([ADR 0001](0001-modular-monolith.md)).

Two code layouts were considered: folders per module inside the two apps, or one pnpm package per
module containing both its backend and frontend parts.

## Decision

- **Modules are enabled per tenant.** A catalog in code lists each module and what it requires:
  `registry` is the base and always on; `warehouse` requires it; `orders` requires `warehouse`;
  `invoicing` requires only `registry` (with orders it also listens to their events, which keeps that
  link optional). Enabling a module without its requirements, or disabling one another module needs,
  is refused; nothing is enabled implicitly except the base.
- **The backend enforces it.** `@RequiresModule('warehouse')` on a controller or route makes a global
  guard read the tenant's modules (as the API role, inside the tenant context) and answer
  `403 MODULE_NOT_ENABLED`. The interface will hide what is not enabled, but the backend is the
  authority.
- **Folders, not packages.** Backend modules live in `apps/api/src/modules/<module>`, frontend
  features in `apps/web/src/features/<module>`, each Prisma model in
  `prisma/schema/<module>.prisma`. A module offers others only what its `index.ts` exports.
- **Boundaries are checked in CI** with dependency-cruiser (`pnpm check:boundaries`): no import of
  another module's internals, no domain knowledge in `shared`, no feature importing another, no
  circular or unresolved imports.

## Consequences

- Selling a module is enabling it for a tenant; the code shipped is the same for everyone.
- A forbidden import fails CI, so boundaries do not erode silently.
- With one Prisma client for all modules, the check cannot detect a module reading another module's
  tables: that rule (only a module's repository touches its models) is kept by convention and review.
- If a module ever has to become a separate service, its narrow `index.ts` and its own tables make
  it extractable.

## Alternatives considered

- **One package per module** (`packages/<module>/{api,web}`): the boundary would be enforced by the
  package manager, but the backend parts would need their own compilation (NestJS decorator
  metadata), project references, a watch process in development, Prisma models collected from every
  package, `peerDependencies` for NestJS and React, and Docker and CI changes. That is a lot of
  configuration for a guarantee the automated check already gives.
- **Convention only**: no tooling, but boundaries erode without anyone noticing.
