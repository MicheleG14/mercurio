import { describe, expect, it } from 'vitest';
import { Money } from '../../shared/money.js';
import {
  assertIssueDate,
  deferredDeadline,
  dueDates,
  invoiceReference,
  needsStampDuty,
} from './invoice-rules.js';

const dates = (date: string, terms: Parameters<typeof dueDates>[1], total = '100.00') =>
  dueDates(date, terms, Money.of(total)).map((d) => `${d.dueDate} ${d.amount.toString()}`);

describe('invoice rules', () => {
  it('names a document by series, number and year', () => {
    expect(invoiceReference({ series: 'FT', number: 12, year: 2026 })).toBe('FT 12/2026');
  });

  describe('due dates', () => {
    it('counts days from the document date, or pays at once', () => {
      expect(dates('2026-11-05', 'RD')).toEqual(['2026-11-05 100.00']);
      expect(dates('2026-11-05', '30DF')).toEqual(['2026-12-05 100.00']);
      expect(dates('2026-12-15', '60DF')).toEqual(['2027-02-13 100.00']);
    });

    it('counts whole months to the end of the month, across February and leap years', () => {
      expect(dates('2026-01-15', '30FM')).toEqual(['2026-02-28 100.00']);
      expect(dates('2026-01-31', '30FM')).toEqual(['2026-02-28 100.00']);
      expect(dates('2028-01-31', '30FM')).toEqual(['2028-02-29 100.00']);
      expect(dates('2026-12-10', '60FM')).toEqual(['2027-02-28 100.00']);
    });

    it('splits the total in instalments, the rest on the last one', () => {
      expect(dates('2026-11-05', '30-60-90FM')).toEqual([
        '2026-12-31 33.33',
        '2027-01-31 33.33',
        '2027-02-28 33.34',
      ]);
      expect(dates('2026-11-05', '30-60DF', '0.01')).toEqual([
        '2026-12-05 0.00',
        '2027-01-04 0.01',
      ]);
    });
  });

  describe('stamp duty', () => {
    const line = (nature: string | null, amount: string, stampDutyCharge = false) => ({
      vatNature: nature,
      lineAmount: Money.of(amount),
      stampDutyCharge,
    });

    it('is due above 77.47 € of exempt, not subject, not taxable or excluded operations', () => {
      expect(needsStampDuty([line('N4', '77.47')])).toBe(false);
      expect(needsStampDuty([line('N4', '77.48')])).toBe(true);
      expect(needsStampDuty([line('N2.2', '40'), line('N3.1', '40')])).toBe(true);
      expect(needsStampDuty([line('N1', '100')])).toBe(true);
    });

    it('ignores VAT lines, reverse charge, other EU countries and its own charge', () => {
      expect(needsStampDuty([line(null, '1000')])).toBe(false);
      expect(needsStampDuty([line('N6.1', '1000'), line('N7', '1000')])).toBe(false);
      expect(needsStampDuty([line('N4', '70'), line('N1', '2.00', true)])).toBe(false);
      expect(needsStampDuty([{ vatNature: null, lineAmount: null, stampDutyCharge: false }])).toBe(
        false,
      );
    });
  });

  describe('issue date', () => {
    const today = '2026-11-05';
    const codeOf = (date: string, last: string | null) => {
      try {
        assertIssueDate(date, today, last);
        return 'OK';
      } catch (error) {
        return (error as { errors: { code: string }[] }).errors[0]!.code;
      }
    };

    it('is today or back to the last document of the series, at most 12 days', () => {
      expect(codeOf(today, null)).toBe('OK');
      expect(codeOf('2026-11-05', '2026-11-05')).toBe('OK');
      expect(codeOf('2026-10-24', null)).toBe('OK');
      expect(codeOf('2026-10-23', null)).toBe('ISSUE_DATE_TOO_OLD');
      expect(codeOf('2026-11-06', null)).toBe('DATE_IN_FUTURE');
      expect(codeOf('2026-11-03', '2026-11-04')).toBe('ISSUE_DATE_BEFORE_LAST');
    });
  });

  it('gives a deferred invoice until the 15th of the month after the oldest delivery note', () => {
    expect(deferredDeadline(['2026-10-20', '2026-10-02'])).toBe('2026-11-15');
    expect(deferredDeadline(['2026-12-31'])).toBe('2027-01-15');
    expect(deferredDeadline([])).toBeNull();
  });
});
