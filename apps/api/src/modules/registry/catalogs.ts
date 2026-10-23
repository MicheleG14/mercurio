/**
 * Reference data fixed by law or by the product, the same for every tenant (docs/adr/0018): a new
 * VAT rate is a release, not a setting. Invoices of phase 5 will copy rate and nature when they
 * are issued, so changing a catalog never alters an issued document. Names are translations in
 * the frontend (G2a): only codes live here.
 */

/**
 * VAT codes: the ordinary rates, and the operations at 0% with the "nature" required by the
 * Italian e-invoice (FatturaPA): N1 excluded (art. 15), N2.x not subject, N3.x not taxable,
 * N4 exempt, N5 margin scheme, N6.x reverse charge, N7 VAT paid in another EU country.
 * Rates are decimal strings with two digits, as in the e-invoice (B30).
 */
export const VAT_CODES = [
  { code: '22', rate: '22.00', nature: null },
  { code: '10', rate: '10.00', nature: null },
  { code: '5', rate: '5.00', nature: null },
  { code: '4', rate: '4.00', nature: null },
  ...[
    'N1',
    'N2.1',
    'N2.2',
    'N3.1',
    'N3.2',
    'N3.3',
    'N3.4',
    'N3.5',
    'N3.6',
    'N4',
    'N5',
    'N6.1',
    'N6.2',
    'N6.3',
    'N6.4',
    'N6.5',
    'N6.6',
    'N6.7',
    'N6.8',
    'N6.9',
    'N7',
  ].map((nature) => ({ code: nature, rate: '0.00', nature })),
] as const satisfies readonly { code: string; rate: string; nature: string | null }[];

/**
 * Units of measure: a short, stable list, each with the decimals a quantity may have in it (one
 * and a half pieces is a typing error; 1.250 kg is not). Quantities are numeric(14,3) (B8), so
 * three decimals at most.
 */
export const UNITS = [
  { code: 'PZ', decimals: 0 },
  { code: 'KG', decimals: 3 },
  { code: 'G', decimals: 3 },
  { code: 'L', decimals: 3 },
  { code: 'M', decimals: 3 },
  { code: 'M2', decimals: 3 },
  { code: 'M3', decimals: 3 },
  { code: 'H', decimals: 2 },
  { code: 'CF', decimals: 0 },
  { code: 'SET', decimals: 0 },
] as const satisfies readonly { code: string; decimals: number }[];

/**
 * Italian legal forms of a company, with their legal category. The category is never stored: it
 * follows from the form.
 */
export const LEGAL_FORMS = [
  { code: 'SRL', category: 'CAPITAL' },
  { code: 'SRLS', category: 'CAPITAL' },
  { code: 'SPA', category: 'CAPITAL' },
  { code: 'SAPA', category: 'CAPITAL' },
  { code: 'SNC', category: 'PARTNERSHIP' },
  { code: 'SAS', category: 'PARTNERSHIP' },
  { code: 'SS', category: 'PARTNERSHIP' },
  { code: 'COOP', category: 'COOPERATIVE' },
  { code: 'CONSORTIUM', category: 'CONSORTIUM' },
  { code: 'OTHER', category: null },
] as const satisfies readonly { code: string; category: string | null }[];

export type Unit = (typeof UNITS)[number]['code'];
export type VatCode = (typeof VAT_CODES)[number]['code'];
export type LegalForm = (typeof LEGAL_FORMS)[number]['code'];

export const isUnit = (value: string): value is Unit => UNITS.some((unit) => unit.code === value);

/** Decimals a quantity may have in this unit; 0 for a code outside the catalog. */
export const unitDecimals = (code: string): number =>
  UNITS.find((unit) => unit.code === code)?.decimals ?? 0;

export const isVatCode = (value: string): value is VatCode =>
  VAT_CODES.some((vat) => vat.code === value);

export const isLegalForm = (value: string): value is LegalForm =>
  LEGAL_FORMS.some((form) => form.code === value);
