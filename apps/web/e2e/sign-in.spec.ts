import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';

const state = JSON.parse(readFileSync(resolve(import.meta.dirname, '.state.json'), 'utf8')) as {
  email: string;
  code: string;
  first: string;
  second: string;
};
const PASSWORD = 'una frase lunga per la prova';

/** The code an authenticator app shows; `stepsAhead` avoids reusing the step just spent. */
function totp(secret: string, stepsAhead = 0): string {
  return new TOTP({ secret: Secret.fromBase32(secret) }).generate({
    timestamp: Date.now() + stepsAhead * 30_000,
  });
}

async function chooseTenant(page: Page, name: string) {
  await expect(page.getByRole('heading', { name: 'Scegli il cliente' })).toBeVisible();
  await page
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Apri' })
    .click();
}

// One person, from the activation code to everyday use, in the browser: the slice of phase 1b
// that "a phase is done when it works from the browser" asks for.
test('activate, enrol, sign in, switch customer and company, sign out', async ({ page }) => {
  // Activation: the code travels in the fragment of the address.
  await page.goto(`/mercurio/activate#${state.code}`);
  await expect(page.getByLabel('Codice di attivazione')).toHaveValue(state.code);
  await page.getByLabel('Nuova password').fill(PASSWORD);
  await page.getByLabel('Ripeti la password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Imposta la password' }).click();

  // Two-factor setup: the QR code and the same secret as text.
  await expect(
    page.getByRole('img', { name: "Codice QR per l'app di autenticazione" }),
  ).toBeVisible();
  const secret = (await page.locator('code').innerText()).trim();
  await page.getByLabel('Codice a 6 cifre').fill(totp(secret));
  await page.getByRole('button', { name: 'Conferma' }).click();

  // Recovery codes: entering requires confirming they were saved.
  await expect(page.getByRole('heading', { name: 'Salva i codici di recupero' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(10);
  const enter = page.getByRole('button', { name: 'Entra in Mercurio' });
  await expect(enter).toBeDisabled();
  await page.getByLabel('Ho salvato i codici in un posto sicuro').check();
  await enter.click();

  // Two customers: the person chooses. As ADMIN of the first, with two companies.
  await chooseTenant(page, state.first);
  await expect(page.getByRole('heading', { name: 'Ciao, Prova Browser' })).toBeVisible();
  const company = page.getByLabel('Azienda:');
  await expect(company.locator('option')).toHaveCount(2);
  await company.selectOption({ label: 'Alfa Logistica Srl' });
  await expect(company).toHaveValue(/.+/);

  // The activity log shows what the terminal commands did.
  await page.getByRole('link', { name: 'Attività' }).click();
  await expect(page.getByRole('cell', { name: 'Persona aggiunta' }).first()).toBeVisible();

  // A reload loses the access token (memory only) but not the session (refresh cookie).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Attività' })).toBeVisible();

  // Sign out, then sign in again with password and code.
  await page.getByRole('button', { name: 'Esci' }).click();
  await expect(page.getByRole('heading', { name: 'Accedi a Mercurio' })).toBeVisible();
  await page.getByLabel('Email').fill(state.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await page.getByLabel('Codice').fill(totp(secret, 1));
  await page.getByRole('button', { name: 'Verifica' }).click();

  // This time the second customer, where the person can only read: no activity log.
  await chooseTenant(page, state.second);
  await expect(page.getByText(`Stai lavorando su ${state.second}`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Attività' })).toHaveCount(0);
  await page.goto('/mercurio/activity');
  await expect(page.getByRole('heading', { name: /^Ciao/ })).toBeVisible();
});

test('refuses a wrong password with the same message as an unknown account', async ({ page }) => {
  await page.goto('/mercurio/login');
  await page.getByLabel('Email').fill(state.email);
  await page.getByLabel('Password').fill('una password sbagliata');
  await page.getByRole('button', { name: 'Accedi' }).click();
  const wrongPassword = await page.getByRole('alert').innerText();

  await page.getByLabel('Email').fill('nessuno@example.com');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('alert')).toHaveText(wrongPassword);
});
