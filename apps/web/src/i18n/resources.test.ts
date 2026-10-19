import { DEFAULT_LANGUAGE, LANGUAGES, resources } from './resources';

/** Every key path of a nested translation object, e.g. "overall.ok". */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

// docs/conventions.md F21: all languages have exactly the same keys, so no screen shows a raw key.
describe('translations', () => {
  const reference = resources[DEFAULT_LANGUAGE];

  it.each(LANGUAGES.filter((language) => language !== DEFAULT_LANGUAGE))(
    '%s has the same keys as the default language',
    (language) => {
      for (const namespace of Object.keys(reference) as (keyof typeof reference)[]) {
        expect(keyPaths(resources[language][namespace]).sort(), `namespace "${namespace}"`).toEqual(
          keyPaths(reference[namespace]).sort(),
        );
      }
    },
  );

  it('has no empty strings', () => {
    for (const language of LANGUAGES) {
      for (const [namespace, values] of Object.entries(resources[language])) {
        const empty = keyPaths(values).filter((path) => {
          const text = path
            .split('.')
            .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], values);
          return typeof text === 'string' && text.trim() === '';
        });
        expect(empty, `${language}/${namespace}`).toEqual([]);
      }
    }
  });
});
