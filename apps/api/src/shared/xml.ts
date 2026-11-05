/**
 * A small XML writer (docs/adr/0033): elements, attributes and text, escaped, indented by two
 * spaces, with the declaration. Without domain knowledge (B5): what goes in a document is its
 * module's business. Enough for documents we write; it does not parse.
 */
export interface XmlElement {
  name: string;
  attributes?: Readonly<Record<string, string>>;
  /** Child elements, or the text of a leaf. Empty children (null, undefined, false) are left out. */
  content?: string | readonly (XmlElement | null | undefined | false)[];
}

/** An element: `el('Numero', '12/2026')`, `el('Sede', [el('CAP', '20121')])`. */
export function el(
  name: string,
  content?: XmlElement['content'],
  attributes?: XmlElement['attributes'],
): XmlElement {
  return { name, content, attributes };
}

/** An element only when it has a value: optional fields of a document. */
export function optional(name: string, value: string | null | undefined): XmlElement | null {
  return value === null || value === undefined || value === '' ? null : el(name, value);
}

/** The document as text, UTF-8, ending with a newline. */
export function serializeXml(root: XmlElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${write(root, 0)}\n`;
}

function write(element: XmlElement, depth: number): string {
  const indent = '  '.repeat(depth);
  const attributes = Object.entries(element.attributes ?? {})
    .map(([key, value]) => ` ${key}="${escape(value)}"`)
    .join('');
  const open = `${indent}<${element.name}${attributes}`;
  const content = element.content;
  if (content === undefined || (Array.isArray(content) && content.every((c) => !c))) {
    return `${open}/>`;
  }
  if (typeof content === 'string') return `${open}>${escape(content)}</${element.name}>`;
  const children = (content as readonly (XmlElement | null | undefined | false)[])
    .filter((child): child is XmlElement => Boolean(child))
    .map((child) => write(child, depth + 1));
  return `${open}>\n${children.join('\n')}\n${indent}</${element.name}>`;
}

/** Escapes the five special characters and drops what XML 1.0 cannot hold at all. */
export function escape(text: string): string {
  return (
    text
      // oxlint-disable-next-line no-control-regex -- control characters are what we remove
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  );
}
