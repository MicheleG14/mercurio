# 0031. Printed documents: made by the API, in the document's language

- Status: Accepted
- Date: 2026-11-05

## Context

Invoices, credit notes and delivery notes are printed and sent. The server has no browser, and a
fiscal document must not depend on the client that shows it. The language of a printed document is
the customer's, not that of the person who prints it, while the backend sends no text for people
(conventions G2a).

## Decision

- The **API makes the PDF** with pdfkit: pages drawn in code (blocks, tables that break across
  pages with their header repeated, totals, a footer with the page number), Geist embedded as in
  the interface. The layout helpers live in `shared/pdf` and know nothing of invoices; invoicing
  and the warehouse lay out their documents with them.
- A PDF is **made at every request from the saved data**, never stored: an issued document is
  immutable (ADR 0028), so it prints the same, byte for byte (the file carries no creation date of
  its own). A draft prints with what it would copy now and a watermark.
- The **language is the document's** (conventions G2b): chosen on the draft, proposed by the
  customer (Italian in Italy, English abroad). The labels of printed documents are in the backend,
  in TypeScript files where both languages have the same type: a label missing in one fails the
  build. This is the one exception to G2a.
- The **delivery note** of a sale is its stock document (`SC-2026/0031`), with how the goods travel
  entered with the shipment (reason, by whom, carrier, packages, appearance, weight).

## Consequences

- No browser and no external service: the image stays small and the PDF is the same everywhere.
- Laying out by hand costs more than HTML would; long tables and page breaks are tested.
- The text inside the PDF is glyphs of an embedded font: tests check the file, its name and its
  stability, not its words.

## Alternatives considered

- **HTML to PDF with Chromium**: a much larger image, a browser to keep up to date on the server.
- **pdfmake**: declarative tables, more convenient; its release was too recent when chosen, and
  pdfkit's explicit drawing is easier to follow.
- **PDF in the browser**: the fiscal document would depend on the client.
