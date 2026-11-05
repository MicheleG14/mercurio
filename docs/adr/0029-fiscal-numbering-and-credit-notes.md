# 0029. Fiscal numbering, dates and credit notes

- Status: Accepted
- Date: 2026-11-05

## Context

In Italy invoices are numbered per year without gaps, and numbers and dates grow together: an
invoice numbered after another cannot be dated before it. An issued invoice is corrected only by a
credit note, which refers to it and never credits more than it billed.

## Decision

- **Series** `FT` for invoices and `NC` for credit notes, each numbered from 1 per company and
  calendar year of the document date (`FT 12/2026`, printed `12/2026`). The database checks that
  the series matches the kind and the year the date.
- A **counter per company, series and year keeps the last number and the last date** (conventions
  B38). The next number comes from one statement, `INSERT … ON CONFLICT DO UPDATE … WHERE
last_date <= new date`: if the date is before the last one, no row comes back and issuing fails
  with `ISSUE_DATE_BEFORE_LAST`; two first invoices of a year at the same time cannot both pass.
  The counter row stays locked until the transaction ends: no gaps, no doubles.
- The date is today by default, never in the future, at most 12 days back (an immediate invoice);
  a deferred one shows its deadline, the 15th of the month after the oldest delivery note.
- Locks when issuing (B34): the draft, the due dates of the invoice a credit note corrects, the
  counter, the shipments to invoice.
- A **credit note** is made from an issued invoice: all its lines or the chosen ones, with what is
  left of each. Its lines have positive amounts, as in the e-invoice (TD04); per line and in total
  it never credits more than is left (`CREDIT_OVER_INVOICED`). It settles the open instalments of
  the invoice from the last one back; what it gives beyond them is owed to the customer, as a due
  date of the credit note, closed by a refund. It moves no goods: a return is a stock document.

## Consequences

- Ten invoices issued at once get ten numbers in a row (tested with parallel requests).
- A document dated in the past must come before any later one of its series: a forgotten invoice
  is issued today, not back-dated past the others.
- The data of credit notes is the e-invoice's (TD04, positive amounts, the credited invoice): the
  XML of a later phase is a translation, not a migration.

## Alternatives considered

- **One numbering for invoices and credit notes**: allowed, but the two documents read differently
  and FatturaPA tells them apart by type anyway.
- **Series configurable per company** (sectional registers): not needed by the demo, and every
  series would need its own rules for dates.
- **Credit notes with negative amounts**: the VAT summary, the PDF and the XML would differ from
  the invoice's; the sign belongs to the payment schedule only.
