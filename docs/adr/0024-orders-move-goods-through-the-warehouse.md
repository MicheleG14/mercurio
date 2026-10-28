# 0024. Orders move goods only through the warehouse

- Status: Accepted
- Date: 2026-10-28

## Context

A purchase order is received and a sales order is shipped: the goods move, so the warehouse must
record a stock document with all its rules (locks, stock never below zero, numbering). The order
must know what moved, line by line, and the two must never disagree: an order that says "shipped"
with no document behind it, or a document that the order does not know about, is a wrong order.

The orders module depends on the warehouse (the catalog of modules says so). The warehouse must
not depend on orders: it is sold without them.

## Decision

- An order records a **fulfilment** (a receipt or a shipment of some lines) by calling the
  warehouse's **public service in its own transaction**: lock the order, check each quantity
  against what is left on its line, let the warehouse record its document, then record the
  fulfilment and the lines' progress. If the warehouse refuses (not enough stock, an archived
  item), nothing is left behind, and its errors come back on the lines of the order's request
  (conventions B35).
- The stock document carries its **origin** as an opaque reference: a kind (`order`), an id and
  how people call it (`OC-2026/0012`). The warehouse keeps it without a foreign key and without
  knowing what an order is; its screens link to the origin.
- **A document with an origin is undone only by its origin**: the warehouse's API answers
  `409 DOCUMENT_HAS_ORIGIN`, and the order's "undo" reverses the document through the public
  service and updates its lines in the same transaction. Otherwise an order would say "shipped" for
  goods that came back.
- The fulfilment and its stock document share the **id chosen by the client** (ADR 0023), so a
  repeated request is one check, not two.
- **Locks follow one order across the two modules** (conventions B34): the order row; on
  confirmation the order counter (reservations carry the order's number); the warehouses, the
  balances by warehouse and item, the reservations; the warehouse's counter. The warehouse never
  locks a row of the orders module, and each counter is taken only by its own document.
- An order is a **draft** until confirmed: no number, free to change and to delete. Confirmed, it
  does not change: what is left can be closed, a confirmed order with nothing moved can be
  cancelled (its number stays used), and any order can be copied into a new draft. Status, moved
  and closed quantities are projections kept in the same transaction as the fulfilments (B11), with
  `CHECK (done + closed <= quantity)`.

## Consequences

- One transaction holds an order and its stock document: there is no state in between to repair.
- The warehouse stays usable alone; orders add documents it records like any other.
- A mistake in a confirmed order is corrected by cancelling or closing it and duplicating it, not
  by editing it: fewer states to reconcile with reservations and fulfilments.

## Alternatives considered

- **The warehouse listens to "order fulfilled" events**: the document would be recorded after the
  order, in another transaction, and a refusal (not enough stock) would come too late to show on the
  order's line.
- **Stock documents reversible from the warehouse too**, with the order finding out by an event:
  a dependency from the warehouse to orders, or an order that is wrong until the event arrives.
- **Editable confirmed orders** (lines not yet moved): reservations and fulfilments to reconcile
  with lines that change under them, for a case "cancel and duplicate" already covers.
