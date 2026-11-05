import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../identity/index.js';
import { RequiresModule, TAX_REGIMES } from '../tenancy/index.js';
import {
  DOCUMENT_LANGUAGES,
  LEGAL_FORMS,
  PAYMENT_METHODS,
  PAYMENT_TERMS,
  UNITS,
  VAT_CODES,
} from './catalogs.js';
import { ReferenceDataDto } from './reference-data.dto.js';

/** The catalogs in code, so the backend stays their only source (docs/adr/0018). */
@ApiTags('registry')
@ApiBearerAuth()
@RequiresModule('registry')
@Controller('registry')
export class ReferenceDataController {
  @Get('reference-data')
  @RequiresPermission('parties:read', 'items:read')
  @ApiOperation({
    summary: 'VAT codes, units of measure, legal forms, payment terms and methods, tax regimes',
  })
  @ApiOkResponse({ type: ReferenceDataDto })
  referenceData(): ReferenceDataDto {
    return {
      vatCodes: VAT_CODES.map((vat) => ({ ...vat })),
      units: UNITS.map((unit) => ({ ...unit })),
      legalForms: LEGAL_FORMS.map((form) => ({ ...form })),
      paymentTerms: PAYMENT_TERMS.map((terms) => ({
        code: terms.code,
        instalments: terms.instalments.map((instalment) => ({ ...instalment })),
      })),
      paymentMethods: [...PAYMENT_METHODS],
      taxRegimes: [...TAX_REGIMES],
      documentLanguages: [...DOCUMENT_LANGUAGES],
    };
  }
}
