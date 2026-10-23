import { INTL_LOCALES, type Language } from '@/i18n/resources';

/**
 * The only place where dates and numbers are formatted (docs/conventions.md F10).
 * Components never call Intl or toLocaleString directly.
 */
function intlLocale(language: string): string {
  return INTL_LOCALES[language as Language] ?? INTL_LOCALES.it;
}

/** A calendar date of the API ("2026-10-23", no time zone) as people read it: "23/10/2026". */
export function formatDate(value: string, language: string): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(intlLocale(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Today in Italian time as YYYY-MM-DD, the day stock documents are dated by default: at 00:30 in
 * Rome it is already tomorrow, whatever the device's time zone.
 */
export function businessToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
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
