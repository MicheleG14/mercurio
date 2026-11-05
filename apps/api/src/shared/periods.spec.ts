import { twelveMonths, yearBounds, yearOrCurrent } from './periods.js';

describe('periods', () => {
  it('gives the bounds of a year', () => {
    expect(yearBounds(2026)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('uses the current business year when none is asked for', () => {
    expect(yearOrCurrent(undefined, '2027-01-01')).toBe(2027);
    expect(yearOrCurrent(2025, '2027-01-01')).toBe(2025);
  });

  it('fills the months without rows, in order', () => {
    const months = twelveMonths(
      [
        { month: 11, n: 5 },
        { month: 2, n: 1 },
      ],
      (month) => ({
        month,
        n: 0,
      }),
    );
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.n)).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0]);
    expect(months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
