# 0019. Decimals travel as strings in JSON

- Status: Accepted
- Date: 2026-10-21

## Context

[ADR 0002](0002-money-as-decimal.md) keeps money in `numeric` columns and `Decimal` values in the
backend. Phase 2 brings the first price to the API, and JSON has only one kind of number: parsed by
JavaScript, `0.1` becomes the nearest binary double, and large prices lose their last digits. The
error would then flow into the invoice calculations of phase 5.

## Decision

- Prices and quantities travel in JSON as **decimal strings with a dot**, `"12.5000"`, never as
  JSON numbers (conventions B30). Requests are validated by `@IsDecimalString` (digits, an optional
  dot and up to the column's decimals, no sign, no exponent); a JSON number is refused.
- Responses always carry the **scale of the column**: a price is `"12.5000"`, so equal values look
  equal.
- The frontend never turns them into numbers: `lib/decimal.ts` formats the string itself with
  `Intl.NumberFormat` (which accepts decimal strings exactly), and turns what a person types in
  their language into the API's string: `12,50` in Italian becomes `"12.50"`. Only the language's
  decimal separator is accepted and no thousands separator: `12.50` typed in Italian is refused
  rather than guessed.

## Consequences

- A price sent as `"0.1"` is stored and returned exactly, and tests compare strings.
- Every client must parse decimals deliberately; the generated types say `string`.
- Typing prices with grouping separators (`1.234,50`) is not supported.

## Alternatives considered

- **JSON numbers**: simplest, and exactly the rounding problem ADR 0002 avoids.
- **Integers in the smallest unit** (cents, ten-thousandths): exact, but every field would need its
  own scale and every screen a conversion.
