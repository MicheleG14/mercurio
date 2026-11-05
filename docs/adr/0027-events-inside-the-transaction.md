# 0027. Events between modules, inside the publisher's transaction

- Status: Accepted
- Date: 2026-11-05

## Context

Invoicing is sold without orders (the catalog of modules says it requires only the registry), yet
with orders it must know every shipment of a sales order, with what the order agreed: an invoice
is made from them. Orders must not know that invoicing exists. And a shipment that is in an
invoice must not be undone from its order: the invoice would bill goods that came back.

## Decision

- Modules talk through **events**: classes named in the past tense (`OrderFulfilledEvent`),
  owned by the module that publishes them, in its `events.ts` file. That file is public like
  `index.ts`; a listener imports nothing else of the publisher (checked by dependency-cruiser:
  invoicing may import only `orders/events.ts`).
- A small **bus written in the project** (`shared/events`) publishes them **in-process, inside the
  publisher's transaction**. Listeners are called one after the other, awaited, with the
  transaction and the company; one that throws makes the publisher fail with it (conventions B4).
- Shipments of sales orders publish `OrderFulfilledEvent`; invoicing writes a row "to invoice"
  with the lines, prices, discounts and VAT of the order, as opaque references (B35). Undoing a
  shipment publishes `OrderFulfilmentReversedEvent` **before** anything moves: invoicing deletes
  its row, or refuses with `409 FULFILMENT_INVOICED` when a draft or an invoice has it.
- Listeners are **idempotent** on the id of the fact. `republish-fulfilments` publishes again every
  shipment that is not undone: for shipments recorded before invoicing existed, or while a tenant
  had it off. A tenant without invoicing hears nothing.
- Locks: the publisher's rows first (the order), then the listener's (the row to invoice), then
  the publisher goes on (the warehouse). A listener never locks rows of another module (B34).

## Consequences

- What the event reports and what listeners record commit or roll back together: no shipment is
  lost, no row to invoice is left for a shipment that failed.
- A listener can refuse, which a later delivery could not.
- A defect in a listener stops the publisher: the listener of a shipment only inserts a row, and
  every event has end-to-end tests.
- Both modules run in one process on one database. Should one become a separate service, the
  events are already the contract; their delivery would move to an outbox.

## Alternatives considered

- **EventEmitter2** (`@nestjs/event-emitter`): made for fire-and-forget events; awaiting the
  listeners, their order, errors that reach the publisher and the transaction passed along would be
  conventions rather than what the code guarantees.
- **Transactional outbox**: events written by the publisher and delivered later. Eventual
  consistency, retries, ordering and idempotence to build, and no way to refuse the undoing of an
  invoiced shipment; out of proportion for a monolith on one database.
- **A view of the orders module read by invoicing**: invoicing would depend on orders, the
  dependency the catalog of modules rules out.
