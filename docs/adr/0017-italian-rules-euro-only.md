# 0017. Italian tax rules and euro only

- Status: Accepted
- Date: 2026-10-21

## Context

The registry is the first module with tax data: VAT numbers, tax codes, VAT rates and the
"nature" of zero-rated operations required by the Italian e-invoice. A generic ERP would group these
rules by country and support several currencies; that machinery is large, and a demonstration
project would end up with many rules done superficially instead of one set done well.

The interface is already in two languages ([ADR 0005](0005-translations-in-frontend.md)): a language
of the interface is not a country of the rules.

## Decision

- Mercurio is an ERP **for Italian businesses**: Italian tax rules (VAT, natures, FatturaPA), and
  amounts **in euro only**. English is a language of the interface, not an opening to the rules of
  other countries.
- **Foreign customers and suppliers are supported**: the Italian checks (VAT number and tax code
  with their check characters, postal code, province, SdI recipient code) apply to parties whose
  country is `IT`; for the others a tax identifier is free text, and Italian-only fields (legal form,
  province) are not used.
- **No per-country structure** in the code: the rules are Italian, with the only condition being the
  country of the party described above.
- **Amounts in a foreign currency** are converted to euro by whoever enters them; the original amount
  and the exchange rate can be written in the notes. Invoices in foreign currencies and exchange
  rates are out of scope, as tenants based abroad are.

## Consequences

- The checks are few, exact and tested: an Italian VAT number or tax code with a wrong check
  character never reaches the database.
- Money stays one currency, so `numeric` columns carry no currency and totals never mix currencies.
- Serving another country would be a project of its own: rules by country, currencies, rates.

## Alternatives considered

- **Rules grouped by country from the start** (a strategy per country): flexible, but every rule
  would need an abstraction before there is a second country to justify it.
- **Several currencies with exchange rates**: needed by a real exporter, out of proportion for the
  scope of this project.
