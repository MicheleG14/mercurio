import { useTranslation } from 'react-i18next';
import { useMe } from '@/lib/auth/me';

/** What the person may do with invoices: the API checks it again on every call (F18). */
export function useInvoicingRights() {
  const permissions = useMe().data?.permissions ?? [];
  return {
    write: permissions.includes('invoicing:write'),
    issue: permissions.includes('invoicing:issue'),
    pay: permissions.includes('payments:write'),
  };
}

/** "30-60 gg fine mese": payment terms in words, from their code (30-60FM). */
export function usePaymentTermsLabel() {
  const { t } = useTranslation('invoicing');
  return (code: string | null | undefined) => {
    if (!code) return '';
    if (code === 'RD') return t('terms.RD');
    const match = /^([\d-]+)(DF|FM)$/.exec(code);
    return match ? t(`terms.${match[2] as 'DF'}`, { days: match[1] }) : code;
  };
}

/** A VAT code in words: "22%", or the nature with what it means ("N4 · Esenti"). */
export function useVatLabel() {
  const { t } = useTranslation('registry');
  return (code: string, nature: string | null) =>
    nature
      ? `${nature} · ${t(`vat.nature.${nature.replace('.', '_') as 'N1'}`)}`
      : t('vat.rate', { rate: code });
}
