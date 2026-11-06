import { expect, type Page, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { expectAccessible } from './axe.js';

// The overview's charts on the demo's twelve months (seed-demo in global-setup), the FatturaPA
// file of an invoice, axe on the main pages in both themes, and the pictures of the README.
// Paola Conti is the demo person no other spec signs in with (one-time codes).
const DEMO_PASSWORD = 'Demo-password-2026';
const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

async function signIn(page: Page) {
  await page.goto('/mercurio/login');
  await page.getByLabel('Email').fill('paola.conti@example.com');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await page
    .getByLabel('Codice')
    .fill(new TOTP({ secret: Secret.fromBase32(DEMO_TOTP_SECRET) }).generate());
  await page.getByRole('button', { name: 'Verifica' }).click();
  // Two customers: she chooses the Rossi group.
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Gruppo Rossi' })
    .getByRole('button', { name: 'Apri' })
    .click();
  await expect(page.getByRole('heading', { name: /^Ciao/ })).toBeVisible();
  await page.getByLabel('Azienda:').selectOption({ label: 'Rossi Srl' });
}

/**
 * A picture for the README, at a fixed size (docs/images, refreshed by hand). On the overview it
 * starts at the charts: the counters above them are not what the picture is about.
 */
async function picture(page: Page, name: string) {
  // A string runs in the page: this file is compiled without the DOM types.
  await page.evaluate(
    "document.getElementById('overview-trends')?.scrollIntoView({ block: 'start' })",
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screens/readme-${name}.png`, fullPage: false });
}

test('the overview charts the year, opens what is behind them, and every page passes axe', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const year = new Date().getFullYear();

  // The charts load after the counters, and say what they measure.
  await expect(page.getByText(`Fatturato e incassato nel ${year}`)).toBeVisible();
  await expect(page.getByText('Da incassare per ritardo')).toBeVisible();
  await expect(page.getByText(`Primi clienti nel ${year}`)).toBeVisible();
  await expect(page.getByText(`Documenti di magazzino nel ${year}`)).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
  await expectAccessible(page, 'overview');
  await picture(page, 'overview-light');

  // The same figures as a table: thirteen rows, a month a row.
  const card = page.locator('[data-slot="card"]', {
    hasText: `Fatturato e incassato nel ${year}`,
  });
  await card.getByRole('button', { name: 'Mostra come tabella' }).click();
  await expect(card.getByRole('row')).toHaveCount(13);
  await card.getByRole('button', { name: 'Mostra il grafico' }).click();

  // A bucket of delay opens the payment schedule filtered. The demo's history ends on the day of
  // the run, so which buckets have due dates changes from day to day: the oldest one that has any.
  const aging = page.locator('[data-slot="card"]', { hasText: 'Da incassare per ritardo' });
  await aging.getByRole('button', { name: 'Mostra come tabella' }).click();
  let bucket: string | undefined;
  for (const name of ['Oltre 90 giorni', '61-90 giorni', '31-60 giorni', '1-30 giorni']) {
    const row = aging.getByRole('row').filter({ has: page.getByRole('link', { name }) });
    if (Number(await row.getByRole('cell').last().textContent()) > 0) {
      bucket = name;
      break;
    }
  }
  expect(bucket, 'the demo has overdue due dates').toBeDefined();
  await aging.getByRole('link', { name: bucket }).click();
  await expect(page).toHaveURL(
    /\/invoicing\/due-dates\?status=overdue(&from=\d{4}-\d{2}-\d{2})?&to=\d{4}-\d{2}-\d{2}$/,
  );
  await expect(page.getByLabel('Scadenze')).toHaveValue('overdue');
  await expect(page.getByRole('row').nth(1)).toBeVisible();
  await expectAccessible(page, 'due-dates');

  // An invoice: its FatturaPA file, named as the format wants.
  await page.goto('/mercurio/invoicing/invoices');
  await expectAccessible(page, 'invoices');
  await page
    .getByRole('link', { name: /^FT \d+\/\d{4}$/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Scarica XML' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Scarica XML' }).click();
  expect((await download).suggestedFilename()).toMatch(/^IT\d{11}_F[0-9A-Z]{4}\.xml$/);
  await expectAccessible(page, 'invoice');
  await picture(page, 'invoice-light');

  // An order, the stock.
  await page.goto('/mercurio/orders/sales');
  await page
    .getByRole('link', { name: /^OC-\d{4}\/\d{4}$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /OC-\d{4}\/\d{4}/ })).toBeVisible();
  await expectAccessible(page, 'order');
  await page.goto('/mercurio/stock');
  await expect(page.getByRole('table')).toBeVisible();
  await expectAccessible(page, 'stock');

  // The dark theme, chosen like a person would, on the same pages.
  await page.evaluate("localStorage.setItem('mercurio.theme', 'dark')");
  await page.goto('/mercurio/');
  await page.getByLabel('Azienda:').selectOption({ label: 'Rossi Srl' });
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
  await expectAccessible(page, 'overview-dark');
  await picture(page, 'overview-dark');
  await page.goto('/mercurio/invoicing/due-dates');
  await expectAccessible(page, 'due-dates-dark');
});
