import { escapeLike, normalizeName } from './text.js';

describe('text helpers', () => {
  it('collapses spaces in names', () => {
    expect(normalizeName('  Gruppo   Rossi ')).toBe('Gruppo Rossi');
  });

  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('A_1')).toBe('A\\_1');
    expect(escapeLike('C:\\dir')).toBe('C:\\\\dir');
    expect(escapeLike('plain')).toBe('plain');
  });
});
