# 0018. Registry: parties with roles, items, archiving and versions

- Status: Accepted
- Date: 2026-10-21

## Context

Warehouse, orders and invoicing all point to customers, suppliers and items. The same business is
often both a customer and a supplier; a private person, a sole trader, a company and an association
need different fields and different checks. Records will be referred to by documents that must never
change, and several people of a tenant edit the same records.

## Decision

- **One `parties` table** for customers and suppliers, with two roles (`is_customer`,
  `is_supplier`, at least one) and a **kind** that decides which fields are required and how they are
  checked: `PRIVATE` (first and last name, personal tax code, no VAT number), `SOLE_TRADER` (owner's
  names, VAT number, optional trade name), `COMPANY` (legal name, VAT number in Italy, optional legal
  form) and `ORGANIZATION` (name, VAT number or 11-digit tax code). The legal form comes from a
  catalog; its category (capital company, partnership…) is derived, not stored. `name` holds the
  legal name or "Last First" for people, so lists sort and search one column.
- **Shared by the companies of a tenant** ([ADR 0009](0009-companies-and-shared-registry.md)): no
  registry route needs `X-Company-Id`.
- **One active party per VAT number** in a tenant (a partial unique index): an archived party does
  not block a new one, and cannot be restored while another active one has its number. The form
  looks up the VAT number and tax code as they are typed and offers the existing party; a duplicate
  answers `409 PARTY_VAT_TAKEN` with the existing party's id (`existingId`, a Problem Details
  extension member). The tax code is not unique: a sole trader and the same person as a private
  customer share it.
- **Items** with a code unique per tenant **regardless of case**, archived items included, and
  **never changed**: documents print the code, so it always means the same item. The API role has no
  update privilege on the column. Description up to 1000 characters and code up to 35, the limits
  of the e-invoice; a list price as `numeric(14,4)`; `stock_managed` false for services.
- **Catalogs in code**: VAT codes (rates and the natures N1-N7 of the e-invoice), units of measure
  and legal forms are fixed by law or by the product and the same for every tenant. Documents of
  later phases copy rate and nature when issued, so changing a catalog never alters them. The
  frontend reads them from `GET /registry/reference-data`.
- **Archived, never deleted** (conventions B31): the API role has no `DELETE` privilege on these
  tables. An archived record is hidden from lists unless asked, cannot be edited, and can be
  restored.
- **Optimistic concurrency** (conventions B29): every record has a `version`; every change,
  archive and restore sends the version it was based on, and the update applies only to that
  version. Otherwise `409 EDIT_CONFLICT`, and the interface offers to reload without losing what was
  typed until the person chooses.
- **Permissions per entity**: `parties:read/write` and `items:read/write` replace the provisional
  `registry:read/write` of [ADR 0014](0014-authorization.md). The accountant edits parties, the
  warehouse keeper items; everyone reads both.
- **Audit**: every change records the names of the changed fields, never their values, so the log
  tells who touched what without copying personal data.
- **Search** is "contains", served by trigram indexes (`pg_trgm`) on names, identifiers, city, codes
  and descriptions. LIKE wildcards typed by the person are escaped.

## Consequences

- A business that is both customer and supplier exists once, with one VAT number.
- The rules of each kind live in one function (`party-rules.ts`) used by the API and the demo seed;
  the form repeats the main ones to show mistakes while typing.
- A typo in an item code is corrected by archiving the item and creating a new one.
- Search does not ignore accents ("citta" does not find "Città"): `unaccent` needs an immutable
  expression index, a complication left for when it is needed.

## Alternatives considered

- **Separate `customers` and `suppliers` tables**: the same business twice, with two VAT numbers to
  keep aligned.
- **VAT rates in a table per tenant**: only useful for custom rates, which the law does not allow.
- **Deleting records never used by a document**: one more rule, and in this phase it would mean
  always.
- **Last write wins**: the second person to save would silently erase the first person's changes.
