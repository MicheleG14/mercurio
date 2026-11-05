# 0034. The demo: a history through the use cases, and a reset

- Status: Accepted
- Date: 2026-11-05

## Context

The demo tenants showed a few weeks of documents with fixed dates: the overview's charts had one or
two months, and what was overdue drifted towards "over 90 days" as time passed. A longer history
cannot be added to existing tenants: numbers and dates of invoices grow together (ADR 0029), so
nothing can be issued before the last invoice of a series. And an issued invoice cannot be deleted
by the API (ADR 0028).

## Decision

- `seed-demo` writes twelve months up to a **reference day** (`--today`, default today), every
  action **through the same use case as the API, on its own day**: purchases received in parts,
  sales shipped in parts, deferred and immediate invoices, credit notes, customers who pay on time,
  late, in batches or not at all, and every special case once. A simulation of the stock keeps every
  quantity possible; what depends on the server's figures (due dates, what is still open) is
  planned when the server returns them. A **seeded generator** gives the same documents, numbers,
  dates and amounts for the same reference day. The seed reports any feature it did not show.
- A demo tenant that exists is left as it is. `reset-demo` **deletes the demo tenants whole** and
  writes them again, in one transaction, then puts back the people outside the demo who belonged to
  them, with the same roles (`--dry-run` lists both first).
- The reset is **the one place where issued fiscal documents are deleted**. It runs from the
  terminal as the owner role, only on the slugs the demo defines; the API role still cannot change
  or delete an issued document (ADR 0028). One function lists what a tenant holds, shared with the
  tests, and checks at the end that no table with a `tenant_id` still has rows of the deleted
  tenants.

## Consequences

- The overview always has a full year, and every bucket of delay something in it.
- A full history takes about a minute and a half (thousands of queries through the use cases); the
  end-to-end suite runs it on the common day and on three edge days (31 December, 1 January,
  29 February), which found a bug of the generator.
- Ids stay random (UUID v7): the story is the same, not the bytes of its keys.
- What a person typed into a demo tenant is lost at the next reset: the demo is fictitious data.

## Alternatives considered

- **Documents dated after the last one only**: keeps the old data, but the history never gets
  longer than what is already there.
- **A demo company of its own for the charts**: no deletion, but an artificial company, and the
  others still half empty.
- **Inserting the history with SQL**: fast, but outside the rules the demo exists to show.
