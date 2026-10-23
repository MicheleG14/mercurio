# 0022. Module boundaries in SQL: published views

- Status: Accepted
- Date: 2026-10-23

## Context

A module never reads another module's tables (conventions B3, [ADR 0011](0011-module-activation-and-boundaries.md)).
`dependency-cruiser` checks imports, but the warehouse needs items and parties in SQL: its stock
list searches and sorts by item code and description, with paging on the server. Asking the
registry's public service for items and joining them in memory breaks paging and sorting as soon as
the search filters.

## Decision

- A module may **publish read-only views**: the part of its data other modules may use, with only
  the columns they need. The registry publishes `registry_item_refs` (id, code, description, unit,
  stock flag, archived) and `registry_party_refs` (id, name, VAT number, roles, archived). Other
  modules join these views, never the tables behind them; the registry may change its tables as long
  as the views keep their columns. They are its `index.ts` in SQL.
- The views are created with `security_invoker`: they run with the privileges and Row-Level Security
  of whoever queries them, so a tenant sees only its own rows through them too.
- For checks inside a use case (the item exists, is a good, is not archived; the party is a
  supplier) the warehouse calls the registry's **public service**, in the same transaction.
- **Foreign keys** between modules are allowed (a movement references an item): they are integrity,
  not reading.
- A unit test reads the hand-written SQL of every module, finds the table names after `FROM`,
  `JOIN`, `INTO` and `UPDATE`, and fails when one belongs to another module (tables are assigned by
  the schema file that maps them). It reads text, it does not parse SQL: a heuristic, declared as
  such.

## Consequences

- The boundary between modules is visible in the database, and checked in CI.
- Prisma does not model the views: they are used only in hand-written queries.

## Alternatives considered

- **Joining in memory** after asking the public service: wrong paging and sorting with a search.
- **Copying code and description into the warehouse's tables**: data to keep aligned, and the
  description of an item changes.
- **An exception** letting the warehouse join the `items` table: works, but the next module would
  ask for the same, and the registry could no longer change its tables freely.
