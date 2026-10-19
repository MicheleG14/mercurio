# 0005. User-facing text lives only in the frontend

- Status: Accepted
- Date: 2026-10-19

## Context

The interface is available in Italian and English, and adding a language must not require code
changes. If both the API and the web app produced user-facing text, every language would have to be
maintained in two places, and API responses would depend on the caller's language.

## Decision

- The **backend never sends text meant for users**. It sends stable codes (error `code`s, see
  [0003](0003-problem-details-errors.md)) and language-neutral values: enum values in the database
  and the API are always codes such as `DRAFT` or `ISSUED`, never translated words.
- The **frontend owns all wording**, with react-i18next: one JSON file per language and per area
  (`src/locales/<lang>/<area>.json`), keys in English by feature. A test checks that every language
  has exactly the same keys.
- Components never contain literal text and never build sentences by concatenation; plurals and
  variables go through the library.
- The language defaults to the browser's, can be changed by the user and is remembered.
- Numbers and dates are formatted only by shared helpers based on `Intl` and the user's locale.

## Consequences

- Adding a language means adding one folder of JSON files and one entry in the resource list.
- The API is simpler and its responses are cacheable regardless of language.
- Generated documents (invoice PDFs) are the exception to watch: their language belongs to the
  document's customer, not to the user who generates them, and their texts will use the same keys.

## Alternatives considered

- **Translated messages from the API** (`Accept-Language`): duplicates translations across two
  codebases and mixes presentation into the API.
- **Hard-coded Italian text**: fastest today, a rewrite of every screen later.
