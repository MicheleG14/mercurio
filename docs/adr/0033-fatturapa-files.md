# 0033. FatturaPA files: made from the issued document, never transmitted

- Status: Accepted
- Date: 2026-11-05

## Context

In Italy an invoice between businesses is an XML file in the FatturaPA format, sent through the
exchange system of the tax agency (SdI). Transmission is out of scope (ADR 0017); the file is not:
it is what an intermediary or the agency's portal accepts, and it shows that the data model holds
everything a real invoice needs. Invoicing already saves the document as issued: seller and customer
copied, lines, VAT summary, stamp duty, due dates, with the codes of the format (document types,
natures, payment methods, tax regimes) (ADR 0028).

## Decision

- `GET /invoices/{id}/xml` gives an issued invoice (`TD01`) or credit note (`TD04`) as a file in
  format **FPR12**, schema **1.2.3** (the one valid since 1 April 2025), to download. Nothing is sent.
- The file is **made at every request from the issued document**, like the PDF (ADR 0031): the same
  document gives the same file, byte for byte. It is built from the same data the API returns for
  the document, in the order of the schema.
- The **sending number** (five characters) is derived, not saved: `F` or `N`, the year in base 36,
  the number in base 36 on three characters. It is unique per company for 36 years; the file is
  named `IT<VAT number>_<sending number>.xml`.
- Texts are kept to the **Latin-1** characters the format accepts: typographic quotes and dashes
  become plain ones, anything else a question mark.
- A deferred invoice names, for each shipment, the customer's order and the delivery note with the
  lines that come from them. Lines of text travel at zero with the VAT of the document. A credit
  note names the invoice it corrects and carries no payment terms.
- A **small XML writer** in `shared` (elements, attributes, escaping, indentation) builds the file;
  the knowledge of the format stays in `invoicing/xml`.
- **Tests validate against the official schema**, kept unchanged in the repository (byte for byte,
  with its SHA-256 in CONTRIBUTING), with `xmllint-wasm` (development only, no system install):
  every case by hand, and every document of the demo.

## Consequences

- An invoice can be handed to an intermediary or uploaded by hand; nothing in Mercurio changes when
  it is.
- The schema checks the form, not the meaning: a wrong code that the schema accepts would pass.
  Unit tests check the codes case by case (payment conditions, destination code, identifiers).
- When the agency publishes a new version, the schema file changes and the tests say what breaks.
- If Mercurio ever transmitted, the file sent would have to be kept as the fiscal document, and the
  sending number saved: a different decision.

## Alternatives considered

- **An XML library** (xmlbuilder2): mature, but a production dependency to write tags.
- **`xmllint` from the system** in CI: an installation for every environment that runs the tests.
- **A sending number from a counter**: a table and a lock for a number nobody transmits.
