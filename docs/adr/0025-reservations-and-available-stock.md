# 0025. Reservations and available stock

- Status: Accepted
- Date: 2026-10-28

## Context

A sales order promises goods to a customer. Without reservations, a counter sale or another order
can take them before the order ships, and the promise breaks. With reservations, every way goods
leave must respect them, including under concurrency: two orders confirmed at once on the last
pieces, or a free issue racing a confirmation.

## Decision

- **Reservations live in the warehouse**, where stock is locked: a table `stock_reservations` (one
  row per order line, with an opaque origin as in ADR 0024) and, on each balance,
  `reserved_quantity`, a projection kept in the same transaction (B11) and protected by
  `CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity)`. **Available stock** is
  `quantity − reserved_quantity`.
- **Every free way out checks the available stock**: an issue, a transfer, the reversal of a
  receipt answer `409 STOCK_INSUFFICIENT` if they would touch reserved goods. A shipment of an order
  takes goods **from its own reservation first**, then from free stock.
- **On confirmation, a sales order reserves what is available**, up to each line's quantity; the
  rest stays **uncovered** and the order is confirmed all the same. "Reserve available" tries again
  when goods arrive; receiving does not reserve by itself, because the person receiving does not
  decide which customer gets the goods.
- An **inventory count below what is reserved** is refused (`409 STOCK_RESERVED`): someone releases
  goods from an order first, choosing which customer waits.
- Closing what is left, cancelling an order, undoing a shipment change reservations in the same
  transaction (undoing a shipment reserves the returned goods for the order again).
- The public service offers one operation, "bring each line to what it wants, or as close as
  available stock allows", which also releases when asked for less. The reorder point is compared
  with available stock.
- Other modules read stock through a published view, `warehouse_stock_refs` (quantity, reserved,
  available), and the reservations through `warehouse_reservation_refs` (ADR 0022).

## Consequences

- The database refuses to promise goods twice or to let promised goods leave, whatever the code
  does; concurrency is handled by the same balance locks as stock documents.
- A database of a previous version (which does not know reservations) refuses an issue of reserved
  goods with a database error instead of a clear `409`: a rollback degrades the message, not the
  data.
- `verify-stock` also compares reserved quantities with the reservations.

## Alternatives considered

- **Reservations computed from the orders** (ordered − shipped): the warehouse could not read them
  without depending on orders, and nothing could protect them with a `CHECK`.
- **Reserving beyond stock** (a negative "available", as some systems allow): simpler to confirm,
  but every screen and rule would then have to explain negative availability.
- **Reducing reservations automatically** when a count finds less: the warehouse would choose which
  customer loses goods, and would change data of the orders module.
- **Reserving goods still incoming** on purchase orders: left for later; for now incoming goods are
  shown, not promised.
