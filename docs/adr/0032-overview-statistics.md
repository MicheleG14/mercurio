# 0032. Overview statistics: computed when asked, per module

- Status: Accepted
- Date: 2026-11-05

## Context

The overview showed counters of today (to invoice, overdue, documents of the day). People also want
the trend: what was invoiced and collected month by month, how late customers pay, what is left to
ship, how much the warehouse moves. The figures already exist, saved and never changed: issued
documents, due dates, payments, orders, stock documents. Each belongs to one module, and no module
reads another's tables (ADR 0022).

## Decision

- **Each module computes its own statistics** and offers them as a read route with the permission
  of its pages: `GET /invoicing/stats?year=` and `/invoicing/aging` (`invoicing:read`),
  `/orders/stats?year=` (`orders:read`), `/stock/stats?year=` (`stock:read`). The overview composes
  them; a person who cannot read invoices sees no invoiced amount.
- **Computed when asked**, with `GROUP BY` on the module's tables, inside the tenant's transaction
  and for the current company, like every read. No summary table, no cache: there is no second copy
  to keep consistent, and at the volumes of a small or medium company a year takes milliseconds.
- **Amounts stay `numeric`** until they leave the API as strings (B8, B30). Credit notes count
  against invoices; refunds and reversals against payments; a reversed stock document and its
  reversal cancel out. Shipments are valued at the order line's price, rounded once per line as
  `Money` does (B36). Months without documents are zero, filled by the API: a chart always has
  twelve bars.
- **The charts** use recharts through shadcn's chart component, so their colours are theme tokens.
  The series colours are three tokens in a fixed order, validated for colour-blind separation,
  lightness and contrast against the card in both themes. Every chart has a table with the same
  figures, and a click opens the list behind the bar (the invoices of a month, the due dates of a
  delay bucket). The chart library is loaded apart from the page: the counters show first.
- An amount becomes a JavaScript number **only to draw a bar** (`chartValue`), never to compute or to
  show it (convention F23).

## Consequences

- No projection to maintain, no event to listen to; a new statistic is a query in its module.
- Each request scans a year of the module's rows. At the demo's volumes (twelve months, hundreds of
  documents) the heaviest query takes under a millisecond and no index was needed.
- The overview makes up to four requests; each fails or loads on its own.

## Alternatives considered

- **Summary tables updated by events**: fast at any volume, but another projection to keep right,
  with its own consistency check. A materialized view is the step to take if volumes ever require
  it.
- **A dashboard page of its own**: one more click for the figures people look at most; the overview
  already decides what to show by modules and permissions.
- **Charts drawn by hand in SVG**: no dependency, but tooltips, axes, resizing and accessibility all
  to write.
