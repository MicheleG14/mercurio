# 0020. Responsive shell: one menu, one layout per screen size, no service worker

- Status: Accepted
- Date: 2026-10-21

## Context

Until version 0.4.0 the signed-in app had its menu in the top bar and was designed for desktops
("usable down to tablets, phones only for looking things up"). With the warehouse, orders and
invoicing the menu grows to more than ten entries, and people want to work from a tablet or a
phone too, not only look things up. Shrinking the desktop page does not work: dense tables and
two-column forms become unusable on a phone.

## Decision

- **Three layouts**, from Tailwind's `md` and `lg` breakpoints, asked through one hook
  (`lib/breakpoint.ts`):
  - **desktop** (≥ 1024 px): a sidebar with the menu grouped by module, which can shrink to icons
    (the choice is remembered in `localStorage`); customer and company in the top bar;
  - **tablet** (768-1023 px): the sidebar stays icons only; the whole menu opens as a panel over
    the content;
  - **phone** (< 768 px): a top bar with the menu button; the same panel, with customer and
    company. No bottom tab bar: it would hold only some entries, different per tenant, and the
    menu would be in two places.
- **One description of the menu** (`app/navigation.ts`): entry, icon, module group, permission,
  module. Every layout draws from it, filtered by permission and enabled module (conventions F22).
- **Shared components adapt, screens do not branch**: `DataTable` shows cards on a phone, built
  from the same columns (each says whether it is the card's title, subtitle or detail) and hides
  secondary columns on a tablet; filters move to a bottom panel; the confirmation dialog rises
  from the bottom; Save and Cancel stay at the bottom of the screen while there are changes;
  controls are at least 44 px high on a phone.
- **Everything works on a phone**: the same screens and API, not a reduced app.
- The sidebar is **shadcn's component for Base UI**, adapted: it no longer stores its state in a
  cookie (it would travel with every API request), and it opens as a panel on tablets.
- **Web app manifest, no service worker**: name, colours and icons, scoped to the base path, so the
  app presents itself properly on a home screen. No offline mode and no cache on the device.

## Consequences

- A new screen gets the three layouts by using the shared components; a new module adds its menu
  entries in one place.
- Playwright runs a dedicated spec on a phone and a tablet viewport (and checks that no page
  scrolls sideways); component tests set the screen width through the fake `matchMedia`.
- Screenshots of the three layouts are kept as a CI artifact, to look at the result.

## Alternatives considered

- **Bottom tab bar on phones** (with "More"): the frequent entries within reach, but two places for
  the menu and a choice of entries that changes with the tenant's modules.
- **Tables scrolling sideways on phones**: less work, much worse to use.
- **A Progressive Web App with a service worker**: installation and offline use. Offline is
  excluded for an ERP (conflicts; invoice numbers and stock levels cannot be decided without the
  server), and without it a service worker costs more than it gives: versions cached across
  continuous deployments, and the obligation never to keep a tenant's data on the device. Postponed
  until a real need appears (for example warehouse work with an unreliable network).
