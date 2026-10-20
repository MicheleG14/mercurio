import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/api';

/**
 * The text shown for a failed call. The server sends a stable `code`, never text (G2a): the
 * words come from the `errors` translation file, with a generic message for codes it does not know.
 */
export function useErrorText() {
  const { t, i18n } = useTranslation('errors');
  return (error: unknown): string => {
    const code = error instanceof ApiError ? error.problem?.code : undefined;
    if (code && i18n.exists(`errors:${code}`)) return t(code as never);
    if (error instanceof ApiError && error.status >= 500) return t('INTERNAL_ERROR');
    if (!(error instanceof ApiError)) return t('NETWORK');
    return t('UNKNOWN');
  };
}
