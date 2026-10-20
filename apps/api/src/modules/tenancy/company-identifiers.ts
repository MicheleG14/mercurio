import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../shared/errors/index.js';

/**
 * Normalizes and validates a VAT number. Italian numbers (country IT) must have 11 digits and a
 * valid check digit; an "IT" prefix and spaces are accepted and removed. Other countries are
 * stored as typed (trimmed, uppercase), since their formats vary.
 */
export function normalizeVatNumber(country: string, value: string): string {
  const vat = value.replace(/\s+/g, '').toUpperCase();
  if (country !== 'IT') {
    if (vat.length === 0) throw invalid('VAT_NUMBER_INVALID', 'empty VAT number');
    return vat;
  }
  const digits = vat.startsWith('IT') ? vat.slice(2) : vat;
  if (!/^\d{11}$/.test(digits)) throw invalid('VAT_NUMBER_INVALID', 'expected 11 digits');
  // All zeros passes the check digit but is never assigned.
  if (/^0+$/.test(digits)) throw invalid('VAT_NUMBER_INVALID', 'not an assigned number');
  if (!hasValidItalianCheckDigit(digits)) throw invalid('VAT_NUMBER_INVALID', 'wrong check digit');
  return digits;
}

/**
 * Italian VAT check digit: odd positions (1st, 3rd…) are summed; even positions are doubled,
 * minus 9 when above 9, and summed; the 11th digit makes the total a multiple of 10.
 */
export function hasValidItalianCheckDigit(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = Number(digits[i]);
    if (i % 2 === 0) {
      sum += digit;
    } else {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    }
  }
  return (10 - (sum % 10)) % 10 === Number(digits[10]);
}

/** Italian tax code of a company: 11 digits, or 16 characters for sole proprietorships. */
export function normalizeTaxCode(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const code = value.replace(/\s+/g, '').toUpperCase();
  if (!/^(\d{11}|[A-Z0-9]{16})$/.test(code)) {
    throw invalid('TAX_CODE_INVALID', 'expected 11 digits or 16 characters');
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
