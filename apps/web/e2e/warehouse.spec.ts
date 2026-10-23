import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { activateAndEnter } from './activation.js';

const state = JSON.parse(readFileSync(resolve(import.meta.dirname, '.state.json'), 'utf8')) as {
  warehouseDesktop: { email: string; code: string };
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

async function snap(page: Page, name: string) {
  await page.screenshot({ path: `screens/desktop-warehouse-${name}.png`, fullPage: true });
}

/** Chooses a record in a search box: opens it, types, picks the option. */
async function choose(page: Page, label: RegExp | string, text: string) {
  const box = page.getByRole('combobox', { name: label });
  await box.click();
  await box.fill(text);
  await page.getByRole('option', { name: new RegExp(text) }).click();
}

// Phase 3 from the browser, in a new tenant of its own: an administrator sets up a warehouse,
// receives goods from a supplier, cannot take out more than there is, reverses a document and
// finds an item below its reorder point.
test('receive goods, refuse a shortage, reverse, see what to reorder', async ({ page }) => {
  const run = String(randomInt(100_000, 1_000_000));
  await activateAndEnter(page, state.warehouseDesktop.code);

  // Two warehouses: codes are stored uppercase.
  for (const [code, name] of [
    ['sede', 'Magazzino della sede'],
    ['DEP', 'Deposito Nord'],
  ]) {
    await page.getByRole('link', { name: 'Magazzini' }).click();
    await page.getByRole('button', { name: 'Nuovo magazzino' }).click();
    await page.getByLabel('Codice').fill(code!);
    await page.getByLabel('Nome').fill(name!);
    await page.getByRole('button', { name: 'Salva' }).click();
    await expect(page.getByRole('cell', { name: code!.toUpperCase() })).toBeVisible();
  }

  // Two items and a supplier, in the registry.
  for (const code of [`PW-A-${run}`, `PW-B-${run}`]) {
    await page.getByRole('link', { name: 'Articoli' }).click();
    await page.getByRole('link', { name: 'Nuovo articolo' }).click();
    await page.getByLabel('Codice', { exact: true }).fill(code);
    await page.getByLabel('Descrizione').fill(`Articolo ${code}`);
    await page.getByRole('button', { name: 'Salva' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
  }
  const supplier = `Fornitore Browser ${run} Srl`;
  await page.getByRole('link', { name: 'Clienti e fornitori' }).click();
  await page.getByRole('link', { name: 'Nuovo soggetto' }).click();
  await page.getByLabel('Ragione sociale').fill(supplier);
  await page.getByLabel('Partita IVA').fill(newVat());
  await page.getByLabel('Fornitore', { exact: true }).check();
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('heading', { name: supplier })).toBeVisible();

  // A receipt from the supplier, with two lines.
  await page.getByRole('link', { name: 'Movimenti' }).click();
  await page.getByRole('link', { name: 'Nuovo carico' }).click();
  await choose(page, 'Fornitore', run);
  await page.getByLabel('Numero del DDT').fill(`DDT ${run}`);
  await choose(page, /Riga 1/, `PW-A-${run}`);
  await page.getByLabel(/Quantità/).fill('10');
  await page.getByRole('button', { name: 'Aggiungi riga' }).click();
  await choose(page, /Riga 2/, `PW-B-${run}`);
  await page
    .getByLabel(/Quantità/)
    .nth(1)
    .fill('5');
  await snap(page, '1-new-receipt');
  await page.getByRole('button', { name: 'Registra' }).click();
  await expect(page.getByRole('heading', { name: /^Documento CA-\d{4}\/0001$/ })).toBeVisible();

  await page.getByRole('link', { name: 'Giacenze' }).click();
  await expect(page.getByRole('row').filter({ hasText: `PW-A-${run}` })).toContainText('10 PZ');
  await snap(page, '2-stock');

  // Taking out more than there is: refused on the line, then recorded with the right quantity.
  await page.getByRole('link', { name: 'Movimenti' }).click();
  await page.getByRole('link', { name: 'Nuovo scarico' }).click();
  await page.getByLabel('Causale').selectOption({ label: 'Consumo interno' });
  await choose(page, /Riga 1/, `PW-A-${run}`);
  await page.getByLabel(/Quantità/).fill('11');
  await page.getByRole('button', { name: 'Registra' }).click();
  await expect(page.getByText('Giacenza insufficiente.')).toBeVisible();
  await page.getByLabel(/Quantità/).fill('4');
  await page.getByRole('button', { name: 'Registra' }).click();
  await expect(page.getByRole('heading', { name: /^Documento SC-\d{4}\/0001$/ })).toBeVisible();

  // Reversed: the goods come back, the document says so.
  await page.getByRole('button', { name: 'Storna' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Storna il documento' }).click();
  await expect(page.getByRole('heading', { name: /^Documento SC-\d{4}\/0002$/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Storno di SC-\d{4}\/0001/ })).toBeVisible();
  await snap(page, '3-reversal');

  // A reorder level makes the second item one to order.
  await page.getByRole('link', { name: 'Giacenze' }).click();
  await page.getByRole('link', { name: `PW-B-${run}` }).click();
  await page.getByRole('button', { name: 'Imposta la soglia' }).first().click();
  await page.getByLabel(/Punto di riordino/).fill('5');
  await page.getByLabel(/Quantità da riordinare/).fill('20');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Deposito Nord' }).getByText('Sotto scorta'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Sotto scorta' }).click();
  await expect(page.getByRole('row').filter({ hasText: `PW-B-${run}` })).toContainText('20 PZ');
  await expect(page.getByRole('row').filter({ hasText: `PW-A-${run}` })).toHaveCount(0);

  // All of it in the activity log.
  await page.getByRole('link', { name: 'Attività' }).click();
  await expect(
    page.getByRole('cell', { name: 'Documento di magazzino stornato' }).first(),
  ).toBeVisible();
});
