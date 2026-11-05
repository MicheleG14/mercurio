// Public surface of the registry module: other modules import from here only (B3).
export { type ItemInput } from './item-rules.js';
export { type PartyInput } from './party-rules.js';
export { RegistryModule } from './registry.module.js';
export {
  type BillingParty,
  type ItemRef,
  type PartyRef,
  RegistryService,
} from './registry.service.js';
export { unitDecimals } from './catalogs.js';
export {
  defaultLanguageFor,
  isDocumentLanguage,
  isPaymentMethod,
  isPaymentTerms,
  isVatCode,
  PAYMENT_TERMS,
  type DocumentLanguage,
  type PaymentMethod,
  type PaymentTerms,
  type VatCode,
} from './catalogs.js';
export {
  type VatCodeInfo,
  vatCodeInfo,
  type VatLine,
  type VatSummary,
  type VatSummaryRow,
  vatSummary,
} from './vat.js';
