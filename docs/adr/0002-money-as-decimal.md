# 0002. Monetary amounts as decimals, never `number`

- Status: Accepted
- Date: 2026-10-19

## Context

Invoices must add up to the cent, and a fiscal document cannot be corrected once issued. JavaScript
`number` is a binary floating-point type: `0.1 + 0.2 !== 0.3`, and rounding errors accumulate across
lines, discounts and VAT.

## Decision

- Amounts are stored as PostgreSQL `numeric` and handled as Prisma `Decimal`:
  - totals and amounts: `numeric(14,2)`
  - unit prices: `numeric(14,4)`
  - quantities: `numeric(14,3)`
- A single `Money` type in the shared module wraps all monetary arithmetic. No module computes money
  with `number`.
- Rounding is decided in one place and documented. VAT is computed on the **total taxable amount per
  VAT rate**, not line by line, and then rounded to the cent.

## Consequences

- Totals are exact and reproducible; the rounding rule is visible and testable in one place.
- Arithmetic is more verbose (`a.plus(b)` instead of `a + b`), and values must be converted
  explicitly at the edges: JSON carries amounts as strings, the UI formats them.
- `Money` gets thorough unit tests, including rounding edge cases.

## Alternatives considered

- **Integers in cents**: exact and fast, but unit prices and quantities need more than two decimals,
  so every field would need its own scale factor.
- **`number` with rounding at the end**: simple, but errors appear in sums and are hard to trace.
