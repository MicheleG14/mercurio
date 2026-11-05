import { HttpStatus } from '@nestjs/common';
import { addDays } from '../../shared/dates.js';
import { DomainException } from '../../shared/errors/index.js';
import { Money } from '../../shared/money.js';
import { PAYMENT_TERMS, type PaymentTerms } from '../registry/index.js';

/** What a kind of document is: its numbering series and its code in the e-invoice. */
export const INVOICE_KINDS = {
  INVOICE: { series: 'FT', documentType: 'TD01' },
  CREDIT_NOTE: { series: 'NC', documentType: 'TD04' },
} as const;

export type InvoiceKindKey = keyof typeof INVOICE_KINDS;

/** "FT 12/2026": how the interface and the audit name a document; it prints "12/2026". */
export function invoiceReference(doc: { series: string; number: number; year: number }): string {
  return `${doc.series} ${doc.number}/${doc.year}`;
}

/** Last day of the month that is `months` after the month of `date`. */
function endOfMonthAfter(date: string, months: number): string {
  const [year, month] = date.split('-').map(Number) as [number, number];
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(year, month - 1 + months + 1, 0)).toISOString().slice(0, 10);
}

/**
 * The due dates of a document (docs/adr/0030): one per instalment of the payment terms, the total
 * split in equal parts with the rest on the last one. "DF" counts days from the document date;
 * "FM" whole months (30 days = one), on the last day of the month: 30FM of 15 January is 28
 * February, of 31 January too.
 */
export function dueDates(
  documentDate: string,
  terms: PaymentTerms,
  total: Money,
): { seq: number; dueDate: string; amount: Money }[] {
  const { instalments } = PAYMENT_TERMS.find((t) => t.code === terms)!;
  const amounts = total.split(instalments.length);
  return instalments.map((instalment, index) => ({
    seq: index + 1,
    dueDate: instalment.endOfMonth
      ? endOfMonthAfter(documentDate, Math.round(instalment.days / 30))
      : addDays(documentDate, instalment.days),
    amount: amounts[index]!,
  }));
}

/** Natures of operations without VAT that need the stamp duty (DPR 642/72, tabella art. 6). */
const STAMPED_NATURES = /^(N1|N2(\.\d)?|N3(\.\d)?|N4)$/;
const STAMP_DUTY_THRESHOLD = Money.of('77.47');
export const STAMP_DUTY = Money.of('2.00');

/**
 * Whether an invoice needs the 2 € stamp duty: its operations exempt, not subject, not taxable
 * or excluded (natures N1-N4) add up to more than 77.47 €. Reverse charge (N6) and VAT paid in
 * another EU country (N7) do not count, nor the line that charges the duty itself.
 */
export function needsStampDuty(
  lines: readonly {
    vatNature: string | null;
    lineAmount: Money | null;
    stampDutyCharge: boolean;
  }[],
): boolean {
  const exempt = Money.sum(
    lines
      .filter((l) => !l.stampDutyCharge && l.lineAmount && l.vatNature)
      .filter((l) => STAMPED_NATURES.test(l.vatNature!))
      .map((l) => l.lineAmount!),
  );
  return exempt.greaterThan(STAMP_DUTY_THRESHOLD);
}

/** How many days back an invoice may be dated: the time to issue an immediate one. */
export const MAX_DAYS_BACK = 12;

/**
 * The date a document is issued with (B38): never in the future, never before the last document
 * of its series (numbers and dates grow together), at most 12 days back. Throws on the field
 * `issueDate`.
 */
export function assertIssueDate(date: string, today: string, lastDate: string | null): void {
  const fail = (code: string) =>
    new DomainException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
      errors: [{ field: 'issueDate', code }],
      detail: lastDate && code === 'ISSUE_DATE_BEFORE_LAST' ? `last: ${lastDate}` : undefined,
    });
  if (date > today) throw fail('DATE_IN_FUTURE');
  if (lastDate && date < lastDate) throw fail('ISSUE_DATE_BEFORE_LAST');
  if (date < addDays(today, -MAX_DAYS_BACK)) throw fail('ISSUE_DATE_TOO_OLD');
}

/**
 * The last day to issue a deferred invoice for goods shipped on these dates: the 15th of the
 * month after the oldest delivery note (art. 21 c. 4 DPR 633/72). A warning, not a rule here.
 */
export function deferredDeadline(deliveryDates: readonly string[]): string | null {
  if (deliveryDates.length === 0) return null;
  const oldest = [...deliveryDates].sort()[0]!;
  // The last day of its month, plus 15 days.
  return addDays(endOfMonthAfter(oldest, 0), 15);
}
