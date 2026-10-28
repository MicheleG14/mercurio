/**
 * Calendar dates of business documents (B9): YYYY-MM-DD strings in Italian time, apart from the
 * timestamps. Stock documents, orders and invoices all date their documents this way.
 */

/** Italian documents are dated in Italian time: 00:30 in Rome is still "yesterday" in UTC. */
export const BUSINESS_TIME_ZONE = 'Europe/Rome';

/** Today in the business time zone, as YYYY-MM-DD. */
export function businessToday(now = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** YYYY-MM-DD plus some days (negative: back), in the calendar, without time zones. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** A valid calendar date as YYYY-MM-DD (2026-02-30 is not). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDays(value, 0) === value;
}

/** For the database: a YYYY-MM-DD date as the midnight UTC Prisma maps to a `date` column. */
export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
