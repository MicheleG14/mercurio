import { INTL_LOCALES, type Language } from '@/i18n/resources';

/**
 * The only place where dates and numbers are formatted (docs/conventions.md F10).
 * Components never call Intl or toLocaleString directly.
 */
function intlLocale(language: string): string {
  return INTL_LOCALES[language as Language] ?? INTL_LOCALES.it;
}

export function formatTime(value: Date | string, language: string): string {
  return new Intl.DateTimeFormat(intlLocale(language), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

/** The two largest non-zero units: in Italian 45 -> "45 s", 3720 -> "1 h 2 min". */
export function formatDuration(totalSeconds: number, language: string): string {
  const units = [
    ['day', Math.floor(totalSeconds / 86_400)],
    ['hour', Math.floor((totalSeconds % 86_400) / 3_600)],
    ['minute', Math.floor((totalSeconds % 3_600) / 60)],
    ['second', Math.floor(totalSeconds % 60)],
  ] as const;

  const firstNonZero = units.findIndex(([, amount]) => amount > 0);
  if (firstNonZero === -1) return format(0, 'second', language);

  return units
    .slice(firstNonZero, firstNonZero + 2)
    .filter(([, amount]) => amount > 0)
    .map(([unit, amount]) => format(amount, unit, language))
    .join(' ');
}

function format(
  amount: number,
  unit: 'day' | 'hour' | 'minute' | 'second',
  language: string,
): string {
  return new Intl.NumberFormat(intlLocale(language), {
    style: 'unit',
    unit,
    unitDisplay: 'short',
  }).format(amount);
}
