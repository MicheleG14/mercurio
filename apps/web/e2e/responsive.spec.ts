import { randomInt } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';

// The interface on a phone and on a tablet (docs/conventions.md F20), with demo people other
// than those of registry.spec.ts, so no two tests spend the same one-time code.
const DEMO_PASSWORD = 'Demo-password-2026';
const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

async function signInAs(page: Page, email: string) {
  await page.goto('/mercurio/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await page
    .getByLabel('Codice')
    .fill(new TOTP({ secret: Secret.fromBase32(DEMO_TOTP_SECRET) }).generate());
  await page.getByRole('button', { name: 'Verifica' }).click();
  await expect(page.getByRole('heading', { name: /^Ciao/ })).toBeVisible();
}

/** A picture of the screen for the CI artifact "responsive-screens", to look at the layout. */
async function snap(page: Page, name: string) {
  await page.screenshot({
    path: `screens/${test.info().project.name}-${name}.png`,
    fullPage: true,
  });
}

/** The page never scrolls sideways: everything fits the width of the screen. */
async function expectNoHorizontalScroll(page: Page) {
  // A string runs in the page: this file is compiled without the DOM types.
  const overflow = (await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )) as number;
  expect(overflow).toBeLessThanOrEqual(0);
}

test('@phone menu in a panel, cards, a record with the actions at the bottom', async ({ page }) => {
  const name = `Cliente Telefono ${randomInt(100_000, 1_000_000)} Srl`;
  await signInAs(page, 'sara.neri@example.com');
  await expectNoHorizontalScroll(page);

  // The menu opens from the top bar, with the company choice.
  await page.getByRole('button', { name: 'Apri il menu' }).click();
  const panel = page.getByRole('dialog', { name: 'Menu principale' });
  await expect(panel.getByLabel('Azienda:')).toBeVisible();
  await snap(page, '1-menu');
  await panel.getByRole('link', { name: 'Clienti e fornitori' }).click();
  await expect(panel).toBeHidden();

  // Cards, not a table.
  await expect(page.getByRole('link', { name: 'Ferramenta Bruni Srl' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await snap(page, '2-list');

  // A new customer, then a change with the bar at the bottom.
  await page.getByRole('link', { name: 'Nuovo soggetto' }).click();
  await page.getByLabel('Ragione sociale').fill(name);
  await page.getByLabel('Partita IVA').fill(newVat());
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salva' })).toHaveCount(0);
  await page.getByLabel('Città', { exact: true }).fill('Como');
  await snap(page, '3-record-changed');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Modifiche salvate.')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Archive from the icon next to the title; the question rises from the bottom.
  await page.getByRole('button', { name: 'Archivia' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await snap(page, '4-confirm');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archivia' }).click();
  await expect(page.getByText(/Questa scheda è archiviata/)).toBeVisible();
});

test('@tablet icons-only sidebar, the table without secondary columns', async ({ page }) => {
  await signInAs(page, 'marco.verdi@example.com');
  await expect(page.getByRole('navigation', { name: 'Menu principale' })).toBeVisible();
  await page.getByRole('link', { name: 'Articoli' }).click();

  await expect(page.getByRole('columnheader', { name: /Codice/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'U.M.' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await snap(page, '1-list');

  // The whole menu opens over the content.
  await page.getByRole('button', { name: 'Apri il menu' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Menu principale' }).getByText('Anagrafiche'),
  ).toBeVisible();
  await snap(page, '2-menu');
});

test('@desktop the sidebar and the list on a desktop', async ({ page }) => {
  await signInAs(page, 'giorgio.bianchi@example.com');
  await page.getByRole('link', { name: 'Clienti e fornitori' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await snap(page, '1-list');
});

/** A made-up Italian VAT number with a valid check digit, different at every run. */
function newVat(): string {
  const first10 = Array.from({ length: 10 }, (_, i) =>
    i === 0 ? randomInt(1, 10) : randomInt(10),
  ).join('');
  let sum = 0;
  first10.split('').forEach((char, i) => {
    const digit = Number(char) * (i % 2 === 0 ? 1 : 2);
    sum += digit > 9 ? digit - 9 : digit;
  });
  return first10 + String((10 - (sum % 10)) % 10);
}
