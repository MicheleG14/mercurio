import type { Company } from '../../generated/prisma/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AMOUNT } from '../../shared/money.js';
import { isDecimalString } from '../../shared/decimal.js';
import { FieldErrors, optionalLine, optionalText } from '../../shared/errors/index.js';
import { isValidIban, normalizeIban } from '../../shared/iban.js';

/**
 * Tax regimes of the seller, as the e-invoice codes them (RegimeFiscale): RF01 is the ordinary
 * one. Only the code is kept; what each means is a translation.
 */
export const TAX_REGIMES = [
  'RF01',
  'RF02',
  'RF04',
  'RF05',
  'RF06',
  'RF07',
  'RF08',
  'RF09',
  'RF10',
  'RF11',
  'RF12',
  'RF13',
  'RF14',
  'RF15',
  'RF16',
  'RF17',
  'RF18',
  'RF19',
] as const;

export type TaxRegime = (typeof TAX_REGIMES)[number];

export const isTaxRegime = (value: string): value is TaxRegime =>
  (TAX_REGIMES as readonly string[]).includes(value);

/** What an administrator fills in for the company's invoices (phase 5). */
export interface CompanyProfileInput {
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  reaOffice?: string | null;
  reaNumber?: string | null;
  shareCapital?: string | null;
  soleShareholder?: boolean | null;
  inLiquidation?: boolean;
  taxRegime?: string;
  iban?: string | null;
  email?: string | null;
  pecEmail?: string | null;
  phone?: string | null;
  chargeStampDuty?: boolean;
}

/** The header data as stored, normalized. */
export interface CompanyProfileData {
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  reaOffice: string | null;
  reaNumber: string | null;
  shareCapital: string | null;
  soleShareholder: boolean | null;
  inLiquidation: boolean;
  taxRegime: string;
  iban: string | null;
  email: string | null;
  pecEmail: string | null;
  phone: string | null;
  chargeStampDuty: boolean;
}

export function profileOf(company: Company): CompanyProfileData {
  return {
    address: company.address,
    postalCode: company.postalCode,
    city: company.city,
    province: company.province,
    reaOffice: company.reaOffice,
    reaNumber: company.reaNumber,
    shareCapital: company.shareCapital?.toFixed(AMOUNT.scale) ?? null,
    soleShareholder: company.soleShareholder,
    inLiquidation: company.inLiquidation,
    taxRegime: company.taxRegime,
    iban: company.iban,
    email: company.email,
    pecEmail: company.pecEmail,
    phone: company.phone,
    chargeStampDuty: company.chargeStampDuty,
  };
}

/**
 * Checks the header data of a company. Italian rules (postal code, province, REA office) apply
 * to Italian companies only, as for parties (docs/adr/0017). Nothing is required here: an
 * invoice requires what it prints when it is issued (`missingForInvoices`).
 */
export function normalizeCompanyProfile(
  country: string,
  input: CompanyProfileInput,
): CompanyProfileData {
  const errors = new FieldErrors();
  const italian = country === 'IT';

  const postalCode = optionalText(input.postalCode)?.toUpperCase() ?? null;
  if (postalCode && (italian ? !/^\d{5}$/.test(postalCode) : postalCode.length > 20)) {
    errors.add('postalCode', 'POSTAL_CODE_INVALID');
  }
  const province = optionalText(input.province)?.toUpperCase() ?? null;
  if (province && !italian) errors.add('province', 'NOT_ALLOWED');
  else if (province && !/^[A-Z]{2}$/.test(province)) errors.add('province', 'PROVINCE_INVALID');
  const reaOffice = optionalText(input.reaOffice)?.toUpperCase() ?? null;
  if (reaOffice && !/^[A-Z]{2}$/.test(reaOffice)) errors.add('reaOffice', 'PROVINCE_INVALID');
  const reaNumber = optionalText(input.reaNumber)?.toUpperCase() ?? null;
  if (reaNumber && !/^[A-Z0-9]{1,20}$/.test(reaNumber)) errors.add('reaNumber', 'REA_INVALID');
  if (Boolean(reaOffice) !== Boolean(reaNumber)) {
    errors.add(reaOffice ? 'reaNumber' : 'reaOffice', 'REQUIRED');
  }

  const capital = optionalText(input.shareCapital);
  if (capital && !isDecimalString(capital, AMOUNT)) errors.add('shareCapital', 'AMOUNT_INVALID');

  const taxRegime = input.taxRegime?.toUpperCase() ?? 'RF01';
  if (!isTaxRegime(taxRegime)) errors.add('taxRegime', 'TAX_REGIME_UNKNOWN');

  const typedIban = optionalText(input.iban);
  const iban = typedIban ? normalizeIban(typedIban) : null;
  if (iban && !isValidIban(iban)) errors.add('iban', 'IBAN_INVALID');

  errors.throwIfAny();
  return {
    address: optionalLine(input.address),
    postalCode,
    city: optionalLine(input.city),
    province,
    reaOffice,
    reaNumber,
    shareCapital: capital ? new Prisma.Decimal(capital).toFixed(AMOUNT.scale) : null,
    soleShareholder: input.soleShareholder ?? null,
    inLiquidation: input.inLiquidation ?? false,
    taxRegime,
    iban,
    email: optionalText(input.email)?.toLowerCase() ?? null,
    pecEmail: optionalText(input.pecEmail)?.toLowerCase() ?? null,
    phone: optionalLine(input.phone),
    chargeStampDuty: input.chargeStampDuty ?? true,
  };
}

/**
 * The fields an invoice needs and the company lacks (art. 21 DPR 633/72: the seller's registered
 * office), empty when it can issue. The IBAN is checked by the invoice, only for bank transfers.
 */
export function missingForInvoices(company: {
  country: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
}): string[] {
  const missing: string[] = [];
  if (!company.address) missing.push('address');
  if (!company.postalCode) missing.push('postalCode');
  if (!company.city) missing.push('city');
  if (company.country === 'IT' && !company.province) missing.push('province');
  return missing;
}
