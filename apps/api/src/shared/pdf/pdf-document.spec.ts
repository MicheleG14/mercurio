import { describe, expect, it } from 'vitest';
import { PdfDocument } from './pdf-document.js';

describe('PdfDocument', () => {
  it('writes a PDF that breaks a long table across pages, with a footer on each', async () => {
    const pdf = new PdfDocument({ title: 'Prova', footer: (n, of) => `Pagina ${n} di ${of}` });
    pdf.heading('Documento di prova', 'sottotitolo');
    pdf.blocks(
      { title: 'Da', lines: ['Rossi Srl', 'Via Roma 1'] },
      { title: 'A', lines: ['Bruni'] },
    );
    pdf.table(
      [
        { label: 'Descrizione', width: 4, value: (row: number) => `Riga ${row} – €, àèìòù` },
        { label: 'Importo', width: 1, align: 'right', value: (row: number) => `${row},00` },
      ],
      Array.from({ length: 200 }, (_, i) => i + 1),
    );
    pdf.totals([['Totale', '20.100,00 €']]);
    const bytes = await pdf.toBuffer();

    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = bytes.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(3);
  });

  it('prints the same bytes twice for the same content', async () => {
    const make = () => {
      const pdf = new PdfDocument({ title: 'Uguale', footer: () => '', watermark: 'BOZZA' });
      pdf.paragraph('Testo');
      return pdf.toBuffer();
    };
    expect((await make()).equals(await make())).toBe(true);
  });
});
