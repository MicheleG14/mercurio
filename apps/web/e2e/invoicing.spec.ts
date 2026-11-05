import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { activateAndEnter } from './activation.js';

const state = JSON.parse(readFileSync(resolve(import.meta.dirname, '.state.json'), 'utf8')) as {
  invoicingDesktop: { email: string; code: string };
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
  await page.screenshot({ path: `screens/desktop-invoicing-${name}.png`, fullPage: true });
}

/** Chooses a record in a search box: opens it, types, picks the option. */
async function choose(page: Page, label: RegExp | string, text: string) {
  const box = page.getByRole('combobox', { name: label });
  await box.click();
  await box.fill(text);
  await page.getByRole('option', { name: new RegExp(text) }).click();
}

// Phase 5 from the browser, in a new tenant of its own: an administrator completes the company's
// data, ships an order to a customer in two deliveries, invoices both in one deferred invoice,
// downloads its PDF, records a payment in part and credits the rest with a credit note.
test('invoice two shipments, print, collect in part, credit the rest', async ({ page }) => {
  const run = String(randomInt(100_000, 1_000_000));
  const item = `FI-${run}`;
  const customer = `Cliente Fatture ${run} Srl`;
  await activateAndEnter(page, state.invoicingDesktop.code);

  // Without its registered office the company cannot issue: fill it in.
  await page.getByRole('link', { name: 'Dati azienda', exact: true }).click();
  await expect(page.getByText(/Per emettere fatture mancano/)).toBeVisible();
  await page.getByLabel('Indirizzo della sede', { exact: true }).fill('Via Roma 1');
  await page.getByLabel('CAP', { exact: true }).fill('20121');
  await page.getByLabel('Comune', { exact: true }).fill('Milano');
  await page.getByLabel('Provincia', { exact: true }).fill('MI');
  await page
    .getByLabel('IBAN per i bonifici', { exact: true })
    .fill('IT60 X054 2811 1010 0000 0123 456');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Pronta per emettere fatture')).toBeVisible();

  await page.getByRole('link', { name: 'Magazzini' }).click();
  await page.getByRole('button', { name: 'Nuovo magazzino' }).click();
  await page.getByLabel('Codice').fill('SEDE');
  await page.getByLabel('Nome').fill('Magazzino della sede');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('cell', { name: 'SEDE', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Articoli' }).click();
  await page.getByRole('link', { name: 'Nuovo articolo' }).click();
  await page.getByLabel('Codice', { exact: true }).fill(item);
  await page.getByLabel('Descrizione').fill(`Articolo ${item}`);
  await page.getByLabel(/Prezzo di vendita/).fill('10');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(item) })).toBeVisible();

  await page.getByRole('link', { name: 'Clienti e fornitori' }).click();
  await page.getByRole('link', { name: 'Nuovo soggetto' }).click();
  await page.getByLabel('Ragione sociale').fill(customer);
  await page.getByLabel('Partita IVA').fill(newVat());
  await page.getByLabel('Indirizzo', { exact: true }).fill('Via Torino 12');
  await page.getByLabel('CAP', { exact: true }).fill('20123');
  await page.getByLabel('Città', { exact: true }).fill('Milano');
  await page.getByLabel('Provincia', { exact: true }).fill('MI');
  await page.getByLabel('Codice destinatario', { exact: true }).fill('ABC1234');
  await page.getByLabel('Condizioni di pagamento', { exact: true }).selectOption('30FM');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('heading', { name: customer })).toBeVisible();

  await page.getByRole('link', { name: 'Movimenti' }).click();
  await page.getByRole('link', { name: 'Nuovo carico' }).click();
  await page.getByLabel('Causale').selectOption({ label: 'Giacenza iniziale' });
  await choose(page, /Riga 1/, item);
  await page.getByLabel(/Quantità/).fill('10');
  await page.getByRole('button', { name: 'Registra' }).click();
  await expect(page.getByRole('heading', { name: /^Documento CA-/ })).toBeVisible();

  // A sales order for 5, shipped in two deliveries.
  await page.getByRole('link', { name: 'Ordini clienti' }).click();
  await page.getByRole('link', { name: 'Nuovo ordine' }).click();
  await choose(page, 'Cliente', customer);
  await choose(page, /Riga 1/, item);
  await page.getByLabel(/Quantità/).fill('5');
  await page.getByRole('button', { name: 'Salva e conferma' }).click();
  await expect(page.getByRole('heading', { name: /^Ordine OC-\d{4}\/0001$/ })).toBeVisible();
  await page.getByRole('link', { name: 'Evadi' }).click();
  await page.getByLabel(/Da spedire/).fill('2');
  await page.getByRole('button', { name: "Registra l'evasione" }).click();
  await expect(page.getByText('Evaso in parte', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Evadi' }).click();
  await page.getByRole('button', { name: "Registra l'evasione" }).click();
  await expect(page.getByText('Evaso', { exact: true }).first()).toBeVisible();

  // Both shipments in one invoice.
  await page.getByRole('link', { name: 'Da fatturare', exact: true }).click();
  await page.getByRole('checkbox', { name: /Scegli SC-\d{4}\/0001/ }).check();
  await page.getByRole('checkbox', { name: /Scegli SC-\d{4}\/0002/ }).check();
  await snap(page, '1-to-invoice');
  await page.getByRole('button', { name: 'Crea fattura' }).click();
  await expect(page.getByRole('heading', { name: 'Bozza di fattura' })).toBeVisible();
  await expect(page.getByText(/Fattura differita: va emessa entro/)).toBeVisible();
  await expect(page.getByText(/61,00\s€/).first()).toBeVisible(); // 50 + 22% VAT
  await snap(page, '2-draft');
  await page.getByRole('button', { name: 'Emetti' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(customer);
  await dialog.getByRole('button', { name: 'Emetti' }).click();
  await expect(page.getByRole('heading', { name: /^Fattura FT 1\/\d{4}$/ })).toBeVisible();
  await expect(page.getByText('Da incassare', { exact: true }).first()).toBeVisible();
  await snap(page, '3-invoice');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Scarica PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(/^FT-\d{4}-0001\.pdf$/);

  // An order with an invoiced shipment cannot undo it.
  await page
    .getByRole('link', { name: /^OC-\d{4}\/0001$/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Annulla la registrazione' }).first().click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Annulla la registrazione' })
    .click();
  await expect(page.getByText(/La spedizione è in una bozza o in una fattura/)).toBeVisible();

  // A payment in part, then a credit note for the rest.
  await page.getByRole('link', { name: 'Fatture', exact: true }).click();
  await page.getByRole('link', { name: /^FT 1\/\d{4}$/ }).click();
  await page.getByRole('link', { name: 'Registra incasso' }).click();
  await page.getByLabel('Importo', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Registra' }).click();
  await expect(page.getByRole('heading', { name: 'Incassi' })).toBeVisible();
  await page.getByRole('link', { name: /^FT 1\/\d{4}$/ }).click();
  await expect(page.getByText('Incassata in parte', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Nota di credito' }).click();
  await page.getByRole('button', { name: 'Storna tutto' }).click();
  await expect(page.getByRole('heading', { name: 'Bozza di nota di credito' })).toBeVisible();
  await page.getByRole('button', { name: 'Emetti' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Emetti' }).click();
  await expect(page.getByRole('heading', { name: /^Nota di credito NC 1\/\d{4}$/ })).toBeVisible();
  // It gave back 20 € more than was open: owed to the customer.
  await expect(page.getByText('Da rimborsare', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Scadenziario', exact: true }).click();
  await snap(page, '4-schedule');
  await page.getByRole('link', { name: 'Attività', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Nota di credito emessa' }).first()).toBeVisible();

  // The schedule on a phone, as it is consulted on the go.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/mercurio/invoicing/due-dates?status=all');
  await expect(page.getByRole('heading', { name: 'Scadenziario' })).toBeVisible();
  await expect(page.getByText(/^FT 1\/\d{4}$/).first()).toBeVisible();
  await page.screenshot({ path: 'screens/phone-invoicing-schedule.png', fullPage: true });
});
