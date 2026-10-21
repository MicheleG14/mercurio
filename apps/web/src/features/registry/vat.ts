import type { TFunction } from 'i18next';
import type { ReferenceData } from './queries';

type VatCode = ReferenceData['vatCodes'][number];

/**
 * "22%" for a rate, "0% · N4 Esenti" for an exemption nature. The codes of the ordinary rates
 * are the rates themselves, so no decimal is turned into a number here (B30).
 */
export function vatLabel(vat: VatCode, t: TFunction<'registry'>): string {
  const rate = t('vat.rate', { rate: vat.nature ? '0' : vat.code });
  if (!vat.nature) return rate;
  // Translation keys cannot hold dots: N2.1 is translated as N2_1.
  const key = vat.nature.replace('.', '_') as 'N1';
  return `${rate} · ${vat.nature} ${t(`vat.nature.${key}`)}`;
}
