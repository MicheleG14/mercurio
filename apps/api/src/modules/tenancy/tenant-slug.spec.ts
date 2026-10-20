import { normalizeName } from '../../shared/text.js';
import { normalizeSlug } from './tenant-slug.js';

describe('tenant slug and names', () => {
  it('lowercases and trims a valid slug', () => {
    expect(normalizeSlug('  Rossi-Group ')).toBe('rossi-group');
  });

  it.each(['rossi group', 'rossi--group', '-rossi', 'rossi_', '', 'a'.repeat(51)])(
    'rejects the slug "%s"',
    (slug) => {
      expect(() => normalizeSlug(slug)).toThrow(expect.objectContaining({ code: 'INVALID_SLUG' }));
    },
  );

  it('collapses spaces in names and requires one', () => {
    expect(normalizeName('  Rossi   Srl ')).toBe('Rossi Srl');
    expect(() => normalizeName('   ')).toThrow(expect.objectContaining({ code: 'INVALID_NAME' }));
  });
});
