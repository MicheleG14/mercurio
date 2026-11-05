import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);

/** Geist, the font of the interface (F6), embedded in every document: the same look on paper. */
const FONTS = {
  regular: require.resolve('@fontsource/geist/files/geist-latin-400-normal.woff'),
  semibold: require.resolve('@fontsource/geist/files/geist-latin-600-normal.woff'),
};

const PAGE = { size: 'A4', margin: 40 } as const;
const TEXT = '#1f1b24';
const MUTED = '#6b6375';
const RULE = '#d9d4df';

export interface Column<R> {
  label: string;
  /** Share of the width, relative to the other columns. */
  width: number;
  align?: 'left' | 'right';
  value: (row: R) => string;
}

/**
 * A printed document (docs/adr/0031): A4 pages, Geist, a footer with the page number, and
 * tables that break across pages repeating their header. It knows nothing of invoices or
 * delivery notes: the modules lay out their documents with it (B5). Text is drawn as given;
 * numbers and dates arrive formatted.
 *
 * @example
 * const pdf = new PdfDocument({ title: 'FT 12/2026', footer: (n, of) => `${n}/${of}` });
 * pdf.heading('Fattura');
 * pdf.table(columns, rows);
 * const bytes = await pdf.toBuffer();
 */
export class PdfDocument {
  private readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;

  constructor(
    private readonly options: {
      title: string;
      /** Text at the foot of each page, given its number and the number of pages. */
      footer: (page: number, pages: number) => string;
      /** Written across every page: a draft is not a valid document. */
      watermark?: string;
    },
  ) {
    this.doc = new PDFDocument({
      size: PAGE.size,
      margin: PAGE.margin,
      bufferPages: true,
      // The same document always prints the same: no creation date of its own in the file.
      info: {
        Title: options.title,
        Producer: 'Mercurio',
        Creator: 'Mercurio',
        CreationDate: new Date(0),
      },
    });
    this.doc.registerFont('regular', FONTS.regular);
    this.doc.registerFont('semibold', FONTS.semibold);
    this.doc.font('regular').fontSize(9).fillColor(TEXT);
    this.doc.on('data', (chunk: Buffer) => this.chunks.push(chunk));
    this.done = new Promise((resolve) =>
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks))),
    );
    if (options.watermark) this.doc.on('pageAdded', () => this.watermark());
    this.watermark();
  }

  private get width(): number {
    return this.doc.page.width - PAGE.margin * 2;
  }

  private get bottom(): number {
    // Room for the footer.
    return this.doc.page.height - PAGE.margin - 20;
  }

  private watermark(): void {
    if (!this.options.watermark) return;
    const { x, y } = this.doc;
    this.doc
      .save()
      .font('semibold')
      .fontSize(48)
      .fillColor(RULE)
      .rotate(-35, { origin: [this.doc.page.width / 2, this.doc.page.height / 2] })
      .text(this.options.watermark, 0, this.doc.page.height / 2 - 24, {
        width: this.doc.page.width,
        align: 'center',
      })
      .restore();
    this.doc.font('regular').fontSize(9).fillColor(TEXT);
    this.doc.x = x;
    this.doc.y = y;
  }

  /** Starts a new page if fewer than `height` points are left on this one. */
  private room(height: number): void {
    if (this.doc.y + height > this.bottom) this.doc.addPage();
  }

  heading(text: string, subtitle?: string): this {
    this.doc.font('semibold').fontSize(16).fillColor(TEXT).text(text, PAGE.margin, this.doc.y);
    if (subtitle) this.doc.font('regular').fontSize(10).fillColor(MUTED).text(subtitle);
    this.doc.font('regular').fontSize(9).fillColor(TEXT).moveDown(0.8);
    return this;
  }

  /** Two blocks side by side (seller and customer, for one): a title and its lines. */
  blocks(...blocks: { title: string; lines: (string | null | undefined)[] }[]): this {
    const top = this.doc.y;
    const gap = 16;
    const width = (this.width - gap * (blocks.length - 1)) / blocks.length;
    let bottom = top;
    blocks.forEach((block, index) => {
      const x = PAGE.margin + index * (width + gap);
      this.doc
        .font('semibold')
        .fontSize(8)
        .fillColor(MUTED)
        .text(block.title.toUpperCase(), x, top, { width });
      this.doc.font('regular').fontSize(9).fillColor(TEXT);
      for (const line of block.lines.filter(Boolean))
        this.doc.text(line!, x, this.doc.y, { width });
      bottom = Math.max(bottom, this.doc.y);
    });
    this.doc.x = PAGE.margin;
    this.doc.y = bottom;
    this.doc.moveDown(1);
    return this;
  }

  /** Label and value pairs on one line each: "Data: 05/11/2026". */
  facts(pairs: [string, string | null | undefined][]): this {
    for (const [label, value] of pairs) {
      if (!value) continue;
      this.room(14);
      this.doc
        .font('semibold')
        .text(`${label}: `, PAGE.margin, this.doc.y, { continued: true })
        .font('regular')
        .text(value);
    }
    this.doc.moveDown(0.8);
    return this;
  }

  /** A table across the width, breaking across pages with its header repeated. */
  table<R>(columns: Column<R>[], rows: readonly R[]): this {
    const total = columns.reduce((sum, c) => sum + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const pad = 3;
    const header = () => {
      this.room(30);
      const y = this.doc.y;
      this.doc.font('semibold').fontSize(8).fillColor(MUTED);
      let x = PAGE.margin;
      columns.forEach((column, i) => {
        this.doc.text(column.label, x + pad, y, {
          width: widths[i]! - pad * 2,
          align: column.align ?? 'left',
        });
        x += widths[i]!;
      });
      this.doc.y = y + 12;
      this.rule();
      this.doc.font('regular').fontSize(9).fillColor(TEXT);
    };
    header();
    for (const row of rows) {
      const values = columns.map((c) => c.value(row));
      const height =
        Math.max(
          ...values.map((value, i) =>
            this.doc.heightOfString(value || ' ', { width: widths[i]! - pad * 2 }),
          ),
        ) + 4;
      if (this.doc.y + height > this.bottom) {
        this.doc.addPage();
        header();
      }
      const y = this.doc.y + 2;
      let x = PAGE.margin;
      values.forEach((value, i) => {
        this.doc.text(value, x + pad, y, {
          width: widths[i]! - pad * 2,
          align: columns[i]!.align ?? 'left',
        });
        x += widths[i]!;
      });
      this.doc.y = y + height - 2;
    }
    this.rule();
    this.doc.x = PAGE.margin;
    this.doc.moveDown(0.6);
    return this;
  }

  /** Lines of a total, right aligned: label and amount, the last one in bold if asked. */
  totals(lines: [string, string][], strongLast = true): this {
    const width = 220;
    const x = PAGE.margin + this.width - width;
    this.room(lines.length * 14 + 6);
    lines.forEach(([label, value], index) => {
      const strong = strongLast && index === lines.length - 1;
      const y = this.doc.y;
      this.doc.font(strong ? 'semibold' : 'regular').fontSize(strong ? 11 : 9);
      this.doc.text(label, x, y, { width: width - 90 });
      this.doc.text(value, x + width - 90, y, { width: 90, align: 'right' });
      this.doc.y = y + (strong ? 16 : 13);
    });
    this.doc.font('regular').fontSize(9).x = PAGE.margin;
    this.doc.moveDown(0.6);
    return this;
  }

  paragraph(text: string, muted = false): this {
    this.room(14);
    this.doc
      .font('regular')
      .fontSize(muted ? 8 : 9)
      .fillColor(muted ? MUTED : TEXT)
      .text(text, PAGE.margin, this.doc.y, { width: this.width });
    this.doc.fillColor(TEXT).moveDown(0.5);
    return this;
  }

  private rule(): void {
    this.doc
      .moveTo(PAGE.margin, this.doc.y)
      .lineTo(PAGE.margin + this.width, this.doc.y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    this.doc.y += 3;
  }

  /** Writes the footers, closes the document and returns its bytes. */
  toBuffer(): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const y = this.doc.page.height - PAGE.margin - 8;
      // Writing below the bottom margin would add a page: lift it for the footer.
      const margin = this.doc.page.margins.bottom;
      this.doc.page.margins.bottom = 0;
      this.doc
        .font('regular')
        .fontSize(7)
        .fillColor(MUTED)
        .text(this.options.footer(i - range.start + 1, range.count), PAGE.margin, y, {
          width: this.width,
          align: 'center',
          lineBreak: false,
        });
      this.doc.page.margins.bottom = margin;
    }
    this.doc.end();
    return this.done;
  }
}
