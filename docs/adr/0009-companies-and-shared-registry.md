# 0009. Companies inside a tenant, shared registry, company as working context

- Status: Accepted
- Date: 2026-10-20

## Context

A tenant is the customer holding the subscription, but invoices, invoice numbering, VAT number and
warehouses belong to a **company**: a legal entity. Groups of related companies are common in Italy
(an operating company and a logistics company, for example), with the same staff, items and
customers. Adding companies later would mean moving fiscal data and changing the numbering of
invoices already issued: the most expensive retrofit possible.

## Decision

- **Several companies per tenant from the start.** A company has its legal name, VAT number (Italian
  numbers checked, check digit included), tax code and country; invoice header data arrives with
  invoicing. Invoices, numbering, warehouses, movements and orders will belong to a company.
- **Registry shared at tenant level.** Customers, suppliers and items are created once and used by
  every company of the tenant: companies of one tenant are related by definition, otherwise they
  would be separate tenants. Data that truly differs per company (a price list, for example) will be
  a per-company detail, not a separate registry.
- **The current company is a working context, not a form field.** The user picks it once (the last
  one used is remembered, per browser tab), sees it at all times and can switch it; lists, stock and
  new documents follow it. A document keeps the company it was created for, whatever the selector
  shows later, and final operations such as issuing an invoice repeat the company in the
  confirmation. The backend checks access to the company on every request.
- **A membership reaches every company or a list of them**; `canAccessCompany` is the single rule.

## Consequences

- A tenant with one company sees no difference: the selector appears only with two or more.
- Every company-scoped table carries `company_id` next to `tenant_id`, with composite foreign keys.
- Out of scope: group consolidation and documents between companies of the same group.

## Alternatives considered

- **One company per tenant** (fiscal data on the tenant): simpler today, painful to split later.
- **Separate registry per company**: easier to reason about, but duplicates items and customers in
  the very groups that need a shared registry.
- **Choosing the company in each form**: slower, and an invoice issued to the wrong company can only
  be corrected with a credit note.
