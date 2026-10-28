# 0026. Amounts and VAT: rounding once, in one place

- Status: Accepted
- Date: 2026-10-28

## Context

Orders carry prices, discounts and VAT, and invoices (phase 5) will be made from them. A cent of
difference between an order and its invoice, or between the screen and the stored total, is the
most visible defect money code can have. ADR 0002 already says amounts are decimals; it did not say
how they are rounded.

## Decision

- Unit prices have 4 decimals, discounts 2, amounts 2 (cents), quantities 3 (B8).
- A **line amount** is quantity × unit price × (100 − discount) / 100, **rounded once at the end**
  to the cent, half a cent away from zero (conventions B36). Nothing in between is rounded.
- **VAT is computed on the sum per VAT code**, rounded to the cent, never line by line: three lines
  of 0.25 at 22% have VAT 0.17, not 3 × 0.06. This is how the Italian e-invoice summarises VAT.
- One class, **`Money`** in `shared/`, holds the rounding; the **VAT summary** lives in the
  `registry` module next to the VAT catalog, as a pure function both orders and invoices use. A
  document copies the **rate and nature** of each line's VAT code when it is written, so a later
  change of the catalog never alters it.
- The web app shows totals while a draft is typed with the same rules (`lib/money.ts`, exact
  integers), tested on the same cases as the API; the API computes them again and is the authority.

## Consequences

- The same lines give the same totals in the order, the invoice and on the screen.
- Totals are stored with the order (lists sort and sum on them) and recomputed whenever a draft is
  saved.

## Alternatives considered

- **VAT per line, then summed**: easier to explain line by line, but it disagrees with the
  e-invoice by a cent on ordinary orders.
- **Rounding the discounted price before multiplying**: a rounding in the middle, so the line
  amount depends on how the price was written.
- **The VAT summary written twice**, once in orders and once in invoicing: two computations that
  can drift apart.
