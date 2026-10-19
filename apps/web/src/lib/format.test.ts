import { formatDuration } from './format';

describe('formatDuration', () => {
  it.each([
    [0, 'en', '0 secs'],
    [45, 'en', '45 secs'],
    [3_720, 'en', '1 hr 2 mins'],
    [90_061, 'en', '1 day 1 hr'],
    [7_200, 'en', '2 hrs'],
  ])('%i seconds in %s -> %s', (seconds, language, expected) => {
    expect(formatDuration(seconds, language)).toBe(expected);
  });

  it('uses the Italian unit names', () => {
    expect(formatDuration(3_720, 'it')).toBe('1 h 2 min');
  });

  it('falls back to Italian for unknown languages', () => {
    expect(formatDuration(45, 'xx')).toBe(formatDuration(45, 'it'));
  });
});
