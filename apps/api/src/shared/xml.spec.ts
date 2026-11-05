import { el, escape, optional, serializeXml } from './xml.js';

describe('xml', () => {
  it('writes nested elements with attributes, indented', () => {
    const xml = serializeXml(
      el('a:Root', [el('Name', 'Rossi & figli'), optional('Empty', null), el('Leaf')], {
        'xmlns:a': 'urn:x',
        versione: '1',
      }),
    );
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<a:Root xmlns:a="urn:x" versione="1">',
        '  <Name>Rossi &amp; figli</Name>',
        '  <Leaf/>',
        '</a:Root>',
        '',
      ].join('\n'),
    );
  });

  it('escapes the special characters and drops control characters', () => {
    expect(escape(`<a href="x">l'1</a>\u0007`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;l&apos;1&lt;/a&gt;',
    );
  });

  it('writes an element whose children are all empty as empty', () => {
    expect(serializeXml(el('A', [null, false, undefined]))).toContain('<A/>');
  });
});
