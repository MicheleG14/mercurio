import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { activateAndEnter } from './activation.js';

const state = JSON.parse(readFileSync(resolve(import.meta.dirname, '.state.json'), 'utf8')) as {
  members: { email: string; code: string };
};

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

// Phase 7 from the browser: an administrator adds a company of the group, defines a role, adds a
// colleague with it and hands over the code; the colleague activates the account and sees only
// what the role allows.
test('a company, a role, a colleague who enters with only what the role allows', async ({
  page,
  browser,
}) => {
  const run = String(randomInt(100_000, 1_000_000));
  await activateAndEnter(page, state.members.code);

  // A second company: the selector of the current company appears.
  await page.getByRole('link', { name: 'Aziende' }).click();
  await page.getByRole('button', { name: 'Aggiungi azienda' }).click();
  await page.getByLabel('Ragione sociale', { exact: true }).fill(`Logistica ${run} Srl`);
  await page.getByLabel('Partita IVA', { exact: true }).fill(newVat());
  await page.getByRole('button', { name: 'Aggiungi azienda' }).last().click();
  await expect(page.getByRole('heading', { name: 'Dati azienda' })).toBeVisible();
  await page.screenshot({ path: 'screens/desktop-members-company.png', fullPage: true });

  // A role of the customer: writing customers brings reading them along.
  await page.getByRole('link', { name: 'Ruoli' }).click();
  await page.getByRole('button', { name: 'Nuovo ruolo' }).click();
  await page.getByLabel('Nome', { exact: true }).fill(`Commerciale ${run}`);
  await page.getByRole('checkbox', { name: /Creare e modificare clienti e fornitori/ }).click();
  await expect(page.getByRole('checkbox', { name: /Vedere clienti e fornitori/ })).toBeChecked();
  await page.screenshot({ path: 'screens/desktop-members-role.png', fullPage: true });
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText(`Commerciale ${run}`)).toBeVisible();

  // A colleague with that role: the code is shown once.
  await page.getByRole('link', { name: 'Persone' }).click();
  await page.getByRole('button', { name: 'Aggiungi persona' }).click();
  await page.getByLabel('Email', { exact: true }).fill(`sales-${run}@example.com`);
  await page.getByLabel('Nome e cognome', { exact: true }).fill('Sara Vendite');
  await page.getByLabel('Ruolo', { exact: true }).selectOption({ label: `Commerciale ${run}` });
  await page.getByRole('button', { name: 'Aggiungi persona' }).last().click();
  const dialog = page.getByRole('alertdialog');
  const code = (await dialog.getByTestId('activation-code').innerText()).trim();
  await page.screenshot({ path: 'screens/desktop-members-code.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Chiudi' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Sara Vendite' });
  await expect(row.getByText('In attesa di attivazione')).toBeVisible();
  await page.screenshot({ path: 'screens/desktop-members-list.png', fullPage: true });

  // The colleague, in a browser of their own.
  const other = await browser.newContext();
  const colleague = await other.newPage();
  await activateAndEnter(colleague, code);
  await expect(colleague.getByRole('link', { name: 'Clienti e fornitori' })).toBeVisible();
  await expect(colleague.getByRole('link', { name: 'Magazzini' })).toHaveCount(0);
  await expect(colleague.getByRole('link', { name: 'Persone' })).toHaveCount(0);
  await other.close();

  await page.reload();
  await expect(row.getByText('Attiva', { exact: true })).toBeVisible();
});
