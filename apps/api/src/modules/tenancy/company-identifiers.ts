import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../shared/errors/index.js';
import {
  compactIdentifier,
  isValidCompanyTaxCode,
  isValidPersonalTaxCode,
  italianVatNumberProblem,
  stripItalianPrefix,
} from '../../shared/italian-identifiers.js';

/**
 * Normalizes and validates a VAT number. Italian numbers (country IT) must have 11 digits and a
 * valid check digit; an "IT" prefix and spaces are accepted and removed. Other countries are
 * stored as typed (trimmed, uppercase), since their formats vary.
 */
export function normalizeVatNumber(country: string, value: string): string {
  if (country !== 'IT') {
    const vat = compactIdentifier(value);
    if (vat.length === 0) throw invalid('VAT_NUMBER_INVALID', 'empty VAT number');
    return vat;
  }
  const digits = stripItalianPrefix(value);
  const problem = italianVatNumberProblem(digits);
  if (problem) throw invalid('VAT_NUMBER_INVALID', problem);
  return digits;
}

/**
 * Italian tax code of a company: 11 digits, or 16 characters for sole proprietorships, with
 * the right check character in both cases.
 */
export function normalizeTaxCode(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const code = compactIdentifier(value);
  if (!isValidCompanyTaxCode(code) && !isValidPersonalTaxCode(code)) {
    throw invalid('TAX_CODE_INVALID', 'expected 11 digits or 16 characters with a check character');
  }
  return code;
}

export function normalizeCountry(value: string | undefined): string {
  const country = (value ?? 'IT').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw invalid('COUNTRY_INVALID', 'expected ISO 3166-1 alpha-2');
  return country;
}

function invalid(code: string, detail: string): DomainException {
  return new DomainException(code, HttpStatus.BAD_REQUEST, { detail });
}
