import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../../shared/errors/index.js';
import { InvoiceQueriesService } from '../invoice-queries.service.js';
import type { InvoiceDto } from '../invoicing.dto.js';
import { type FatturaPaFile, fatturaPa } from './fattura-pa.js';

/**
 * What a FatturaPA file needs and the issue rules do not already ask for: a document issued
 * before a rule existed may lack it. Fields as `seller.postalCode`, `customer.address`.
 */
export function missingForXml(invoice: InvoiceDto): string[] {
  const missing: string[] = [];
  const check = (who: 'seller' | 'customer', party: Record<string, unknown>) => {
    const text = (key: string) => (typeof party[key] === 'string' ? (party[key] as string) : '');
    if (!text('address')) missing.push(`${who}.address`);
    if (!text('city')) missing.push(`${who}.city`);
    if (text('country') === 'IT' && !/^\d{5}$/.test(text('postalCode'))) {
      missing.push(`${who}.postalCode`);
    }
  };
  check('seller', invoice.seller);
  check('customer', invoice.customer);
  if (!invoice.customer.vatNumber && !invoice.customer.taxCode) missing.push('customer.taxCode');
  return missing;
}

/** The FatturaPA file of an issued document, made on every request (docs/adr/0033). */
@Injectable()
export class InvoiceXmlService {
  constructor(private readonly queries: InvoiceQueriesService) {}

  async file(id: string): Promise<FatturaPaFile> {
    const invoice = await this.queries.getInvoice(id);
    const missing = missingForXml(invoice);
    if (missing.length > 0) {
      throw new DomainException('XML_DATA_INCOMPLETE', HttpStatus.CONFLICT, {
        errors: missing.map((field) => ({ field, code: 'REQUIRED' })),
      });
    }
    return fatturaPa(invoice);
  }
}
