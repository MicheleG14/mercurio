import { z } from 'zod';
import {
  compactVat,
  isValidCompanyTaxCode,
  isValidItalianVat,
  isValidPersonalTaxCode,
} from '../identifiers';
import type { Party, PartyBody } from '../queries';

export const PARTY_KINDS = ['COMPANY', 'SOLE_TRADER', 'PRIVATE', 'ORGANIZATION'] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

const text = z.string();

/**
 * The party form. Every field is text (or a flag) while editing; partyBody turns it into what the
 * API expects. The rules mirror the API's (docs/adr/0018) so most mistakes show while typing; the
 * API checks again and its field errors land on the same fields.
 */
export const partySchema = z
  .object({
    kind: z.enum(PARTY_KINDS),
    isCustomer: z.boolean(),
    isSupplier: z.boolean(),
    legalName: text,
    firstName: text,
    lastName: text,
    legalForm: text,
    vatNumber: text,
    taxCode: text,
    country: text,
    address: text,
    postalCode: text,
    city: text,
    province: text,
    email: text,
    phone: text,
    pecEmail: text,
    sdiCode: text,
    notes: text,
  })
  .superRefine((v, ctx) => {
    const fail = (path: string, code: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message: `validation.${code}` });
    const italian = v.country === 'IT';
    const person = v.kind === 'PRIVATE' || v.kind === 'SOLE_TRADER';
    const filled = (value: string) => value.trim() !== '';

    if (!v.isCustomer && !v.isSupplier) fail('isCustomer', 'PARTY_NEEDS_ROLE');
    if (person && !filled(v.firstName)) fail('firstName', 'REQUIRED');
    if (person && !filled(v.lastName)) fail('lastName', 'REQUIRED');
    if (!person && !filled(v.legalName)) fail('legalName', 'REQUIRED');

    if (italian && v.kind !== 'PRIVATE') {
      if (filled(v.vatNumber) && !isValidItalianVat(v.vatNumber)) {
        fail('vatNumber', 'VAT_NUMBER_INVALID');
      }
      if (!filled(v.vatNumber) && (v.kind === 'COMPANY' || v.kind === 'SOLE_TRADER')) {
        fail('vatNumber', 'REQUIRED');
      }
    }
    if (italian && filled(v.taxCode)) {
      if (person && !isValidPersonalTaxCode(v.taxCode)) fail('taxCode', 'TAX_CODE_PERSON');
      if (!person && !isValidCompanyTaxCode(v.taxCode)) fail('taxCode', 'TAX_CODE_COMPANY');
    }
    if (italian && v.kind === 'PRIVATE' && !filled(v.taxCode)) fail('taxCode', 'REQUIRED');
    if (italian && v.kind === 'ORGANIZATION' && !filled(v.vatNumber) && !filled(v.taxCode)) {
      fail('taxCode', 'PARTY_NEEDS_IDENTIFIER');
    }
    if (italian && filled(v.postalCode) && !/^\d{5}$/.test(v.postalCode.trim())) {
      fail('postalCode', 'POSTAL_CODE_INVALID');
    }
    if (italian && filled(v.province) && !/^[a-z]{2}$/i.test(v.province.trim())) {
      fail('province', 'PROVINCE_INVALID');
    }
    if (filled(v.sdiCode) && !/^[a-z0-9]{7}$/i.test(v.sdiCode.trim())) {
      fail('sdiCode', 'SDI_CODE_INVALID');
    }
    for (const field of ['email', 'pecEmail'] as const) {
      if (filled(v[field]) && !z.email().safeParse(v[field].trim()).success) {
        fail(field, 'IS_EMAIL');
      }
    }
  });

export type PartyFormValues = z.infer<typeof partySchema>;

/** Field names, to place the API's field errors (B17). */
export const PARTY_FIELDS = Object.keys(partySchema.shape) as (keyof PartyFormValues)[];

export const emptyParty: PartyFormValues = {
  kind: 'COMPANY',
  isCustomer: true,
  isSupplier: false,
  legalName: '',
  firstName: '',
  lastName: '',
  legalForm: '',
  vatNumber: '',
  taxCode: '',
  country: 'IT',
  address: '',
  postalCode: '',
  city: '',
  province: '',
  email: '',
  phone: '',
  pecEmail: '',
  sdiCode: '',
  notes: '',
};

export function partyValues(party: Party): PartyFormValues {
  return {
    kind: party.kind,
    isCustomer: party.isCustomer,
    isSupplier: party.isSupplier,
    legalName: party.legalName ?? '',
    firstName: party.firstName ?? '',
    lastName: party.lastName ?? '',
    legalForm: party.legalForm ?? '',
    vatNumber: party.vatNumber ?? '',
    taxCode: party.taxCode ?? '',
    country: party.country,
    address: party.address ?? '',
    postalCode: party.postalCode ?? '',
    city: party.city ?? '',
    province: party.province ?? '',
    email: party.email ?? '',
    phone: party.phone ?? '',
    pecEmail: party.pecEmail ?? '',
    sdiCode: party.sdiCode ?? '',
    notes: party.notes ?? '',
  };
}

/** Which fields the form shows for a kind and a country (the others are not sent). */
export function visibleFields(kind: PartyKind, country: string) {
  const italian = country === 'IT';
  const person = kind === 'PRIVATE' || kind === 'SOLE_TRADER';
  return {
    legalName: kind !== 'PRIVATE',
    personNames: person,
    legalForm: kind === 'COMPANY' && italian,
    vatNumber: kind !== 'PRIVATE',
    province: italian,
  };
}

/** The body for the API: blanks become null, fields the kind does not use are emptied. */
export function partyBody(values: PartyFormValues): PartyBody {
  const show = visibleFields(values.kind, values.country);
  const value = (text: string) => (text.trim() === '' ? null : text.trim());
  return {
    kind: values.kind,
    isCustomer: values.isCustomer,
    isSupplier: values.isSupplier,
    legalName: show.legalName ? value(values.legalName) : null,
    firstName: show.personNames ? value(values.firstName) : null,
    lastName: show.personNames ? value(values.lastName) : null,
    legalForm: show.legalForm ? value(values.legalForm) : null,
    vatNumber: show.vatNumber ? value(values.vatNumber) : null,
    taxCode: value(values.taxCode),
    country: values.country,
    address: value(values.address),
    postalCode: value(values.postalCode),
    city: value(values.city),
    province: show.province ? value(values.province) : null,
    email: value(values.email),
    phone: value(values.phone),
    pecEmail: value(values.pecEmail),
    sdiCode: value(values.sdiCode),
    notes: value(values.notes),
  };
}

/** The identifier to look up while typing, once it looks complete; undefined otherwise. */
export function lookupIdentifiers(
  values: Pick<PartyFormValues, 'vatNumber' | 'taxCode' | 'country'>,
) {
  const vat = compactVat(values.vatNumber);
  const taxCode = values.taxCode.replace(/\s+/g, '').toUpperCase();
  const italian = values.country === 'IT';
  return {
    vatNumber: vat && (!italian || isValidItalianVat(vat)) ? vat : undefined,
    taxCode:
      taxCode && (!italian || isValidPersonalTaxCode(taxCode) || isValidCompanyTaxCode(taxCode))
        ? taxCode
        : undefined,
  };
}
