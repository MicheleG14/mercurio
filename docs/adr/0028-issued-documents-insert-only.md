# 0028. Issued invoices are immutable by privileges

- Status: Accepted
- Date: 2026-11-05

## Context

An issued invoice is a fiscal document: it must never change. The usual way, a status column and
code that refuses to update an issued row, leaves the promise to the code. The API role would
still have `UPDATE` on the table: one bug, and an issued invoice changes.

## Decision

- **Drafts live in tables of their own** (`invoice_drafts`, `invoice_draft_lines`), free to change
  and to delete, with a version (B29).
- **Issued documents** (`invoices`, `invoice_lines`, `invoice_vat_rows`) are **insert-only** for
  the API role: `SELECT, INSERT`, no `UPDATE`, no `DELETE`. Issuing reads the draft, checks it
  again, inserts the document **with the draft's id** (a second click finds it, ADR 0023) and
  deletes the draft, in one transaction (conventions B37).
- What a document prints of others is **copied when it is issued**: the seller (registered office,
  REA, capital, tax regime) and the customer (address, identifiers, SdI code, PEC), as JSON, with
  the payment terms, the IBAN, the VAT summary and the totals. Changing a customer's address
  tomorrow does not change yesterday's invoice.
- What changes after issue is **not the document**: how much of each due date is settled
  (`invoice_due_dates.settled_amount`, the only column the API may update), and the payment status
  computed from it.
- A test checks the privileges; another proves that `UPDATE` and `DELETE` on issued documents fail
  with `permission denied`.

## Consequences

- "The database refuses to change an issued invoice" holds whatever the code does, without a
  trigger.
- Issued rows cannot be locked with `SELECT … FOR UPDATE` (PostgreSQL asks for an `UPDATE`
  privilege): what needs serializing on an invoice (credit notes, payments) locks its due dates.
- The PDF is made from the saved data at every request and is the same every time.
- **One exception, outside the API: the demo.** `reset-demo` deletes the fictitious demo tenants
  whole, issued invoices included, and writes them again with a fresh history. It runs as the owner
  role from the terminal, only on the slugs the demo defines, in one transaction, and never through
  the application: the API role still cannot change or delete an issued document. A demo tenant can
  be thrown away as a whole; a document is never changed.

## Alternatives considered

- **One table with a status and a trigger** refusing changes to issued rows: the API role keeps
  `UPDATE`, and the guarantee is a function to keep right (B28).
- **One table, the check in the code only**, as for order drafts: the central promise of the
  project left to the code.
- **The seller and the customer in columns**: thirty columns that change with every field the PDF
  prints; the copy is a picture for printing, never filtered in SQL (lists use the party's id).
