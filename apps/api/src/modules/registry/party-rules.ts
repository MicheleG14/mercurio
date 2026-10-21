import type { PartyKind } from '../../generated/prisma/client.js';
import {
  compactIdentifier,
  isValidCompanyTaxCode,
  isValidPersonalTaxCode,
  italianVatNumberProblem,
  stripItalianPrefix,
} from '../../shared/italian-identifiers.js';
import { isLegalForm } from './catalogs.js';
import { FieldErrors, optionalLine, optionalText } from './field-errors.js';

/** What a person fills in for a party: the form, before any rule is applied. */
export interface PartyInput {
  kind: PartyKind;
  isCustomer: boolean;
  isSupplier: boolean;
  /** Legal name: companies and organizations, optional for sole traders. */
  legalName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  legalForm?: string | null;
  vatNumber?: string | null;
  taxCode?: string | null;
  country?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  email?: string | null;
  phone?: string | null;
  pecEmail?: string | null;
  sdiCode?: string | null;
  notes?: string | null;
}

/** A party as stored: every field normalized, `name` computed for sorting and searching. */
export interface PartyData {
  kind: PartyKind;
  isCustomer: boolean;
  isSupplier: boolean;
  name: string;
  firstName: string | null;
  lastName: string | null;
  legalForm: string | null;
  vatNumber: string | null;
  taxCode: string | null;
  country: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  email: string | null;
  phone: string | null;
  pecEmail: string | null;
  sdiCode: string | null;
  notes: string | null;
}

const PEOPLE: readonly PartyKind[] = ['PRIVATE', 'SOLE_TRADER'];

/** "Last First": how people are named in lists, next to companies. */
export const personName = (firstName: string, lastName: string) => `${lastName} ${firstName}`;

/**
 * The legal name a person typed, given a stored party: companies and organizations always have
 * one; a sole trader has one only when it differs from the owner's name (otherwise it was
 * computed); a private person never.
 */
export function legalNameOf(party: Pick<PartyData, 'kind' | 'name' | 'firstName' | 'lastName'>) {
  if (party.kind === 'PRIVATE') return null;
  if (party.kind === 'SOLE_TRADER' && party.firstName && party.lastName) {
    return party.name === personName(party.firstName, party.lastName) ? null : party.name;
  }
  return party.name;
}

/**
 * Applies the rules of the party's kind (docs/adr/0018): which fields are required, allowed and
 * how Italian identifiers are checked. Italian rules apply to parties with country IT only;
 * for the others an identifier is free text (ADR 0017). Throws 400 VALIDATION_FAILED listing
 * every broken rule by field.
 */
export function normalizeParty(input: PartyInput): PartyData {
  const errors = new FieldErrors();
  const country = (optionalText(input.country) ?? 'IT').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) errors.add('country', 'COUNTRY_INVALID');
  const italian = country === 'IT';
  const isPerson = PEOPLE.includes(input.kind);

  if (!input.isCustomer && !input.isSupplier) errors.add('isCustomer', 'PARTY_NEEDS_ROLE');

  // Names: people need first and last name; companies and organizations a legal name.
  const firstName = isPerson ? optionalLine(input.firstName) : null;
  const lastName = isPerson ? optionalLine(input.lastName) : null;
  const legalName = input.kind === 'PRIVATE' ? null : optionalLine(input.legalName);
  if (isPerson && !firstName) errors.add('firstName', 'REQUIRED');
  if (isPerson && !lastName) errors.add('lastName', 'REQUIRED');
  if (!isPerson && !legalName) errors.add('legalName', 'REQUIRED');
  const name = legalName ?? (firstName && lastName ? personName(firstName, lastName) : '');
  if (name.length > 200) errors.add(legalName ? 'legalName' : 'lastName', 'TOO_LONG');

  // Legal form: only Italian companies, from the catalog.
  let legalForm = optionalText(input.legalForm)?.toUpperCase() ?? null;
  if (legalForm && (input.kind !== 'COMPANY' || !italian)) {
    errors.add('legalForm', 'NOT_ALLOWED');
    legalForm = null;
  } else if (legalForm && !isLegalForm(legalForm)) {
    errors.add('legalForm', 'LEGAL_FORM_UNKNOWN');
  }

  const vatNumber = normalizeVat(input, italian, errors);
  const taxCode = normalizeTaxCode(input, italian, errors);
  if (italian && input.kind === 'ORGANIZATION' && !vatNumber && !taxCode) {
    errors.add('taxCode', 'PARTY_NEEDS_IDENTIFIER');
  }

  // Address: postal code and province follow Italian rules for Italy; abroad there is no province.
  let postalCode = optionalText(input.postalCode)?.toUpperCase() ?? null;
  let province = optionalText(input.province)?.toUpperCase() ?? null;
  if (italian) {
    if (postalCode && !/^\d{5}$/.test(postalCode)) errors.add('postalCode', 'POSTAL_CODE_INVALID');
    if (province && !/^[A-Z]{2}$/.test(province)) errors.add('province', 'PROVINCE_INVALID');
  } else if (province) {
    errors.add('province', 'NOT_ALLOWED');
    province = null;
  }
  if (postalCode && postalCode.length > 20) {
    errors.add('postalCode', 'POSTAL_CODE_INVALID');
    postalCode = null;
  }

  // SdI recipient code: 7 letters or digits; 0000000 is valid and means "use the PEC".
  const sdiCode = optionalText(input.sdiCode)?.toUpperCase() ?? null;
  if (sdiCode && !/^[A-Z0-9]{7}$/.test(sdiCode)) errors.add('sdiCode', 'SDI_CODE_INVALID');

  errors.throwIfAny();
  return {
    kind: input.kind,
    isCustomer: input.isCustomer,
    isSupplier: input.isSupplier,
    name,
    firstName,
    lastName,
    legalForm,
    vatNumber,
    taxCode,
    country,
    address: optionalLine(input.address),
    postalCode,
    city: optionalLine(input.city),
    province,
    email: optionalText(input.email)?.toLowerCase() ?? null,
    phone: optionalLine(input.phone),
    pecEmail: optionalText(input.pecEmail)?.toLowerCase() ?? null,
    sdiCode,
    notes: optionalText(input.notes),
  };
}

/** Private people have no VAT number; sole traders and Italian companies must have one. */
function normalizeVat(input: PartyInput, italian: boolean, errors: FieldErrors): string | null {
  const typed = optionalText(input.vatNumber);
  if (input.kind === 'PRIVATE') {
    if (typed) errors.add('vatNumber', 'NOT_ALLOWED');
    return null;
  }
  if (!typed) {
    if (italian && (input.kind === 'SOLE_TRADER' || input.kind === 'COMPANY')) {
      errors.add('vatNumber', 'REQUIRED');
    }
    return null;
  }
  if (!italian) return compactIdentifier(typed);
  const digits = stripItalianPrefix(typed);
  if (italianVatNumberProblem(digits)) errors.add('vatNumber', 'VAT_NUMBER_INVALID');
  return digits;
}

/**
 * People have a 16-character personal code (required for private people in Italy); companies
 * and organizations an 11-digit one, checked like a VAT number.
 */
function normalizeTaxCode(input: PartyInput, italian: boolean, errors: FieldErrors) {
  const typed = optionalText(input.taxCode);
  if (!typed) {
    if (italian && input.kind === 'PRIVATE') errors.add('taxCode', 'REQUIRED');
    return null;
  }
  const code = compactIdentifier(typed);
  if (!italian) return code;
  const valid = PEOPLE.includes(input.kind)
    ? isValidPersonalTaxCode(code)
    : isValidCompanyTaxCode(code);
  if (!valid) errors.add('taxCode', 'TAX_CODE_INVALID');
  return code;
}
