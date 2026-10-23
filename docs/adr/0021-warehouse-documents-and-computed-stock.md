# 0021. Warehouse: immutable stock documents, stock computed from movements

- Status: Accepted
- Date: 2026-10-23

## Context

The warehouse is where the project's consistency rules become real. Goods move in and out of
warehouses of each company (S2, [ADR 0009](0009-companies-and-shared-registry.md)), several people
record at the same time, and a mistake must never silently rewrite what happened. Stock must not go
below zero, not even when two people take out the last pieces in the same instant. Orders (next
phase) and invoices will reuse the same shapes: a document with lines, numbering per company and
year without gaps, correction by a reversing document.

## Decision

- **Warehouses per company**, with a short uppercase code unique in the company and never changed
  (documents print it), archived only when empty. Composite foreign keys
  `(tenant_id, company_id, id)` keep a document, its warehouses and its movements in one company.
- **Stock documents with lines and a reason** from a catalog in code: opening stock, receipt from a
  supplier (with the supplier's delivery note), return from a customer, issue for sale, internal
  use, loss (notes required), inventory adjustment (the line says what was counted; the movement is
  the difference) and transfer between two warehouses of the company (two movements per line).
- **Documents and movements are append-only** (conventions B32): the API role has `INSERT` and
  `SELECT` on them, nothing else. A mistake is corrected by **reversing** the whole document: a new
  document with the opposite movements, dated today, pointing to the original. A unique index on
  that pointer allows one reversal per document; a reversal is not reversed.
- **Stock is computed from movements** (conventions B11). The current stock of each item in each
  warehouse is a projection, `stock_balances`, written only in the transaction that writes the
  movements, with `CHECK (quantity >= 0)`. Stock at a past date and an item's history are always
  sums over the movements, never the projection. A test after every scenario and the terminal
  command `verify-stock` check that each balance equals the sum of its movements.
- **Locking in a fixed order** (conventions B34). Recording a document locks, in one transaction:
  its warehouses (`FOR SHARE`, against archiving), then the balances it touches (`FOR UPDATE`,
  created at zero when missing, sorted by warehouse then item), then the counter of its series.
  Only then it checks that no balance goes below zero (`409 STOCK_INSUFFICIENT`, on the lines to
  blame), writes the document and its movements and updates the balances. The second of two
  concurrent issues waits for the first and sees the stock it left; two documents on the same items
  in opposite order queue instead of deadlocking.
- **Numbering per company, series and year without gaps**: series by type (`CA` receipts, `SC`
  issues, `RE` adjustments, `TR` transfers, reversals in the series of what they reverse), numbers
  as `CA-2026/0042`. The number is taken with `INSERT … ON CONFLICT DO UPDATE … RETURNING` on a
  counter row, inside the document's transaction: a failed document gives its number back.
- **Dates** in Italian time: today by default, up to 30 days back, never in the future.
- **Reorder levels** per item and warehouse: a point at or below which the item is "below reorder",
  and a quantity to order. Compared with physical stock (reservations arrive with orders).
- **Permissions** `stock:read` (everyone), `stock:write` (administrators and warehouse keepers:
  documents, reversals, reorder levels) and `warehouses:manage` (administrators) replace the
  provisional `warehouse:*` of [ADR 0014](0014-authorization.md). Every route needs the warehouse
  module and a company (`X-Company-Id`).
- **Items**: only goods (`stock_managed`) move; that flag no longer changes after an item is
  created. An archived item may only go out, to clear what is left.

## Consequences

- Concurrency is decided by the database, and tested with real parallel requests.
- Lists of stock, with the filter "below reorder", sorting and paging, are simple queries on the
  projection; the price is keeping it aligned, which one use case and one transaction do.
- Backdating is allowed but checked against today's stock: a document dated in the past can leave
  the stock of an earlier day negative in the history. Declared, as many systems do; checking every
  later date would mean recomputing them all.
- No valuation (average cost, FIFO), lots, serial numbers or locations: out of scope.

## Alternatives considered

- **Only the sum of movements, with an advisory lock** per warehouse and item: nothing to keep
  aligned, but lists and "below reorder" become grouped sums over every movement.
- **A database trigger** keeping the projection: stronger against a mistake in the code, but logic
  in PL/pgSQL, harder to explain, and another privileged function to justify (B28).
- **Editable documents or drafts**: more states, and an edited movement is history rewritten; a
  reversal says what happened.
