import { randomInt } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';

// The demo people of seed-demo (apps/api/src/cli/seed-demo.ts): fictitious, and with these
// credentials only outside production.
const DEMO_PASSWORD = 'Demo-password-2026';
const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

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

// Phase 2 from the browser: an administrator of the demo works on customers and items; a
// read-only person sees the records without being able to change them.
test('an administrator creates, finds, changes, archives and restores a customer and an item', async ({
  page,
}) => {
  const run = String(randomInt(100_000, 1_000_000));
  const name = `Cliente Browser ${run} Srl`;
  await signInAs(page, 'anna.rossi@example.com');

  // A new customer with a VAT number.
  await page.getByRole('link', { name: 'Clienti e fornitori' }).click();
  await page.getByRole('link', { name: 'Nuovo soggetto' }).click();
  await page.getByLabel('Ragione sociale').fill(name);
  await page.getByLabel('Partita IVA').fill(newVat());
  await page.getByLabel('Città', { exact: true }).fill('Milano');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page).toHaveURL(/\/mercurio\/parties\/[0-9a-f-]{36}$/);

  // Found again with the search, which also lands in the address.
  await page.getByRole('link', { name: 'Clienti e fornitori' }).click();
  await page.getByRole('searchbox', { name: /Cerca per nome/ }).fill(run);
  await expect(page).toHaveURL(new RegExp(`q=${run}`));
  await page.getByRole('link', { name }).click();
  // Labels match by substring: wait for the record, or "Città" would also find the search box.
  await expect(page.getByRole('heading', { name })).toBeVisible();

  // Changed, archived and restored.
  await page.getByLabel('Città', { exact: true }).fill('Bergamo');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Modifiche salvate.')).toBeVisible();
  await page.getByRole('button', { name: 'Archivia' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archivia' }).click();
  await expect(page.getByText(/Questa scheda è archiviata/)).toBeVisible();
  await expect(page.getByLabel('Città', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Ripristina' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Ripristina' }).click();
  await expect(page.getByText(/Questa scheda è archiviata/)).toHaveCount(0);
  await expect(page.getByLabel('Città', { exact: true })).toHaveValue('Bergamo');

  // An item with a price typed in Italian, shown as an amount in euro.
  const code = `PW-${run}`;
  await page.getByRole('link', { name: 'Articoli' }).click();
  await page.getByRole('link', { name: 'Nuovo articolo' }).click();
  await page.getByLabel('Codice', { exact: true }).fill(code);
  await page.getByLabel('Descrizione').fill('Articolo di prova dal browser');
  await page.getByLabel('Prezzo di vendita (€)').fill('12,50');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
  await expect(page.getByLabel('Prezzo di vendita (€)')).toHaveValue('12,50');
  await page.getByRole('link', { name: 'Articoli' }).click();
  await page.getByRole('searchbox', { name: /Cerca per codice/ }).fill(code);
  const row = page.getByRole('row').filter({ hasText: code });
  await expect(row).toContainText(/12,50\s€/);

  // Every change is in the activity log.
  await page.getByRole('link', { name: 'Attività' }).click();
  await expect(page.getByRole('cell', { name: 'Soggetto ripristinato' }).first()).toBeVisible();
});

test('a read-only person sees the records but cannot change them', async ({ page }) => {
  await signInAs(page, 'luca.gallo@example.com');
  await page.getByRole('link', { name: 'Clienti e fornitori' }).click();
  await expect(page.getByRole('link', { name: 'Nuovo soggetto' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Ferramenta Bruni Srl' }).click();

  await expect(page.getByText(/Sola lettura/)).toBeVisible();
  await expect(page.getByLabel('Ragione sociale')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Salva' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archivia' })).toHaveCount(0);
});
