import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateXML } from 'xmllint-wasm';

// The official FatturaPA schema, FPR12 1.2.3 (fatturapa.gov.it, "Documentazione valida dal 1
// aprile 2025"), and the W3C signature schema it imports, kept unchanged in
// test/fixtures/fatturapa (SHA-256 in CONTRIBUTING.md). Only the import is pointed, in memory, at
// the local copy, so validation needs no network.
const FIXTURES = resolve(import.meta.dirname, '../fixtures/fatturapa');
const read = (name: string) => readFileSync(resolve(FIXTURES, name), 'utf8').replace(/^﻿/, '');
const SCHEMA = read('Schema_VFPR12_v1.2.3.xsd').replace(
  /schemaLocation="http:\/\/www\.w3\.org\/TR\/2002\/REC-xmldsig-core-20020212\/xmldsig-core-schema\.xsd"/,
  'schemaLocation="xmldsig-core-schema.xsd"',
);
const SIGNATURE = read('xmldsig-core-schema.xsd');

/** What the schema finds wrong in a FatturaPA file: empty when it is valid. */
export async function fatturaPaErrors(xml: string): Promise<string[]> {
  const result = await validateXML({
    xml: [{ fileName: 'fattura.xml', contents: xml }],
    schema: [{ fileName: 'fatturapa.xsd', contents: SCHEMA }],
    preload: [{ fileName: 'xmldsig-core-schema.xsd', contents: SIGNATURE }],
    modifyArguments: (args) => [...args, '--nonet'],
  });
  return result.errors.map((e) => e.message);
}
