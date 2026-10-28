import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { activateAndEnter } from './activation.js';

const state = JSON.parse(readFileSync(resolve(import.meta.dirname, '.state.json'), 'utf8')) as {
  ordersDesktop: { email: string; code: string };
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
  await page.screenshot({ path: `screens/desktop-orders-${name}.png`, fullPage: true });
}

/** Chooses a record in a search box: opens it, types, picks the option. */
async function choose(page: Page, label: RegExp | string, text: string) {
  const box = page.getByRole('combobox', { name: label });
  await box.click();
  await box.fill(text);
  await page.getByRole('option', { name: new RegExp(text) }).click();
}

async function newParty(page: Page, name: string, role: 'Cliente' | 'Fornitore') {
  await page.getByRole('link', { name: 'Clienti e fornitori' }).click();
  await page.getByRole('link', { name: 'Nuovo soggetto' }).click();
  await page.getByLabel('Ragione sociale').fill(name);
  await page.getByLabel('Partita IVA').fill(newVat());
  if (role === 'Fornitore') {
    await page.getByRole('checkbox', { name: 'Cliente', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Fornitore', exact: true }).check();
  }
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

// Phase 4 from the browser, in a new tenant of its own: an administrator orders from a supplier
// and receives in two deliveries; takes a customer's order for more than there is, sees it
// uncovered, reserves what arrives, ships part of it and undoes the shipment.
test('order, receive in parts, reserve, ship and undo', async ({ page }) => {
  const run = String(randomInt(100_000, 1_000_000));
  const [itemA, itemB] = [`OA-${run}`, `OB-${run}`];
  await activateAndEnter(page, state.ordersDesktop.code);

  await page.getByRole('link', { name: 'Magazzini' }).click();
  await page.getByRole('button', { name: 'Nuovo magazzino' }).click();
  await page.getByLabel('Codice').fill('SEDE');
  await page.getByLabel('Nome').fill('Magazzino della sede');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('cell', { name: 'SEDE', exact: true })).toBeVisible();

  for (const code of [itemA, itemB]) {
    await page.getByRole('link', { name: 'Articoli' }).click();
    await page.getByRole('link', { name: 'Nuovo articolo' }).click();
    await page.getByLabel('Codice', { exact: true }).fill(code);
    await page.getByLabel('Descrizione').fill(`Articolo ${code}`);
    await page.getByLabel(/Prezzo di vendita/).fill('10');
    await page.getByRole('button', { name: 'Salva' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
  }
  await newParty(page, `Fornitore Ordini ${run} Srl`, 'Fornitore');
  await newParty(page, `Cliente Ordini ${run} Srl`, 'Cliente');

  // A purchase order with two lines, confirmed at once.
  await page.getByRole('link', { name: 'Ordini fornitori' }).click();
  await page.getByRole('link', { name: 'Nuovo ordine' }).click();
  await choose(page, 'Fornitore', `Fornitore Ordini ${run}`);
  await choose(page, /Riga 1/, itemA);
  await page.getByLabel(/Quantità/).fill('10');
  await page.getByLabel('Prezzo').fill('6');
  await page.getByRole('button', { name: 'Aggiungi riga' }).click();
  await choose(page, /Riga 2/, itemB);
  await page
    .getByLabel(/Quantità/)
    .nth(1)
    .fill('4');
  await expect(page.getByText(/73,20\s€/)).toBeVisible(); // 60 + 22% VAT
  await snap(page, '1-new-purchase');
  await page.getByRole('button', { name: 'Salva e conferma' }).click();
  await expect(page.getByRole('heading', { name: /^Ordine OF-\d{4}\/0001$/ })).toBeVisible();
  await expect(page.getByText('In arrivo', { exact: true })).toBeVisible();

  // First delivery: 6 of A, nothing of B. Then the rest.
  await page.getByRole('link', { name: 'Ricevi' }).click();
  const arrived = page.getByLabel(/Arrivata/);
  await arrived.nth(0).fill('6');
  await arrived.nth(1).fill('0');
  await page.getByLabel('Numero del DDT del fornitore').fill(`DDT ${run}`);
  await snap(page, '2-receive');
  await page.getByRole('button', { name: 'Registra la ricezione' }).click();
  await expect(page.getByText('Ricevuto in parte', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^CA-\d{4}\/0001$/ })).toBeVisible();
  await page.getByRole('link', { name: 'Ricevi' }).click();
  await page.getByRole('button', { name: 'Tutto' }).click();
  await page.getByRole('button', { name: 'Registra la ricezione' }).click();
  await expect(page.getByText('Ricevuto', { exact: true })).toBeVisible();
  await snap(page, '3-received');

  // A sales order for 15 of A: only 10 are there, 5 stay uncovered.
  await page.getByRole('link', { name: 'Ordini clienti' }).click();
  await page.getByRole('link', { name: 'Nuovo ordine' }).click();
  await choose(page, 'Cliente', `Cliente Ordini ${run}`);
  await choose(page, /Riga 1/, itemA);
  await expect(page.getByLabel('Prezzo')).toHaveValue('10,00');
  await page.getByLabel(/Quantità/).fill('15');
  await page.getByRole('button', { name: 'Salva e conferma' }).click();
  await expect(page.getByRole('heading', { name: /^Ordine OC-\d{4}\/0001$/ })).toBeVisible();
  await expect(page.getByText('Scoperto', { exact: true })).toBeVisible();
  await snap(page, '4-uncovered');

  // Promised goods do not leave with a free issue.
  await page.getByRole('link', { name: 'Giacenze' }).click();
  await expect(page.getByRole('row').filter({ hasText: itemA })).toContainText('0 disponibili');

  // Five more arrive without an order; the sales order reserves them.
  await page.getByRole('link', { name: 'Movimenti' }).click();
  await page.getByRole('link', { name: 'Nuovo carico' }).click();
  await page.getByLabel('Causale').selectOption({ label: 'Giacenza iniziale' });
  await choose(page, /Riga 1/, itemA);
  await page.getByLabel(/Quantità/).fill('5');
  await page.getByRole('button', { name: 'Registra' }).click();
  await expect(page.getByRole('heading', { name: /^Documento CA-/ })).toBeVisible();
  await page.getByRole('link', { name: 'Ordini clienti' }).click();
  await page.getByRole('link', { name: /^OC-\d{4}\/0001$/ }).click();
  await page.getByRole('button', { name: 'Prenota disponibile' }).click();
  await expect(page.getByText('Scoperto', { exact: true })).toHaveCount(0);

  // Ship 12 of the 15 reserved, then undo it: the goods come back reserved.
  await page.getByRole('link', { name: 'Evadi' }).click();
  await expect(page.getByLabel(/Da spedire/)).toHaveValue('15');
  await page.getByLabel(/Da spedire/).fill('12');
  await page.getByRole('button', { name: "Registra l'evasione" }).click();
  await expect(page.getByText('Evaso in parte', { exact: true })).toBeVisible();
  await expect(page.getByLabel('evasi 12 su 15')).toBeVisible();
  await snap(page, '5-shipped');
  await page.getByRole('button', { name: 'Annulla la registrazione' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Annulla la registrazione' })
    .click();
  await expect(page.getByText('Da evadere', { exact: true })).toBeVisible();
  await expect(page.getByLabel('evasi 0 su 15')).toBeVisible();

  // All of it in the activity log.
  await page.getByRole('link', { name: 'Attività' }).click();
  await expect(
    page.getByRole('cell', { name: 'Ricezione o evasione annullata' }).first(),
  ).toBeVisible();
});
