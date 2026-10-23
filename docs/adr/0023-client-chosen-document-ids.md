# 0023. Documents created once: the client chooses the id

- Status: Accepted
- Date: 2026-10-23

## Context

A stock document sent twice (a double click, a phone repeating a request after the network
dropped the answer) would load the same goods twice. Disabling the button does not cover a lost
answer.

## Decision

- The client chooses the **id of a new document** (a UUID version 7, conventions B7) when it opens
  the form, and sends it with the document (conventions B33).
- If a document with that id already exists **with the same content**, the API answers `200` with
  it instead of recording another; with different content, `409 DOCUMENT_ID_REUSED`. "Same content"
  compares reason, date, warehouses, party, delivery note, notes and lines, quantities as decimals
  (`3` and `3.000` are the same).
- The primary key makes this hold for simultaneous requests too: one insert wins, the other one
  fails on the key and looks at what was committed.

## Consequences

- No table of idempotency keys to keep and clean, and no header to document.
- Orders and invoices will follow the same rule.

## Alternatives considered

- **An `Idempotency-Key` header** with a table of keys and responses: more general, but one more
  table and its cleanup for a case the id already covers.
- **Only disabling the button**: does not help when the answer is lost.
