import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../identity/index.js';
import { RequiresModule } from '../tenancy/index.js';
import { LEGAL_FORMS, UNITS, VAT_CODES } from './catalogs.js';
import { ReferenceDataDto } from './reference-data.dto.js';

/** The catalogs in code, so the backend stays their only source (docs/adr/0018). */
@ApiTags('registry')
@ApiBearerAuth()
@RequiresModule('registry')
@Controller('registry')
export class ReferenceDataController {
  @Get('reference-data')
  @RequiresPermission('parties:read', 'items:read')
  @ApiOperation({ summary: 'VAT codes, units of measure and legal forms' })
  @ApiOkResponse({ type: ReferenceDataDto })
  referenceData(): ReferenceDataDto {
    return {
      vatCodes: VAT_CODES.map((vat) => ({ ...vat })),
      units: UNITS.map((unit) => ({ ...unit })),
      legalForms: LEGAL_FORMS.map((form) => ({ ...form })),
    };
  }
}
