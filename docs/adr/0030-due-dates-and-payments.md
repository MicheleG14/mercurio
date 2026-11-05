# 0030. Due dates and payments

- Status: Accepted
- Date: 2026-11-05

## Context

An invoice is paid by its due dates, in one or more instalments, and a payment may settle several
of them, of several invoices of one customer. What is paid must never exceed what is due, also when
two payments arrive at the same time, and an issued invoice must not change to record it.

## Decision

- **Payment terms** are a catalog in code (`RD`, `30DF`, `30FM`, `30-60-90FM`…): instalments in
  days from the document date, or in whole months to the end of the month (30FM of 15 or 31 January
  falls on 28 February). The total, VAT included, is split in equal parts of whole cents, the rest
  on the last one (`Money.split`). The due dates are computed and saved when the document is
  issued; the customer's terms are proposed by the draft.
- **Settled** is a projection on each due date (B11): the payments and credit notes allocated to
  it, kept in the same transaction, with `CHECK (settled_amount >= 0 AND settled_amount <= amount)`.
  `verify-invoicing` compares it with its allocations.
- A **payment** (or a **refund** of a credit note) is append-only: date, amount, method (e-invoice
  codes MP01…), reference, and how it is allocated to due dates of its customer. It locks those due
  dates (in the order of documents and instalments), checks each allocation against what is open
  and that they add up to the amount. It is undone by another payment that reverses it, with the
  allocations negated; a payment is reversed at most once (unique index).
- The **payment status** (unpaid, partly paid, paid, credited; for a credit note settled, refund
  due, refunded) and "overdue" are computed, never stored.

## Consequences

- Two payments on the same due date cannot both settle it (tested in parallel).
- The schedule is a query on due dates; credit notes count against what customers owe.
- Advance payments not tied to an invoice, bank reconciliation and unpaid RIBA are out of scope.

## Alternatives considered

- **A paid flag or paid amount on the invoice**: the invoice would change after issue (ADR 0028),
  and instalments would lose their own state.
- **Payments that settle invoices, not due dates**: the schedule could not tell which instalment
  is late.
