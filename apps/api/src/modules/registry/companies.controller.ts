import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequiresCompany } from '../auth/index.js';
import { RequiresPermission } from '../identity/index.js';
import { RequiresModule } from '../tenancy/index.js';
import { CompaniesService } from './companies.service.js';
import { CompanyDto, UpdateCompanyDto } from './companies.dto.js';

@ApiTags('registry')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Company-Id',
  required: true,
  description: 'The company to work on, one the person can reach',
})
@RequiresModule('registry')
@RequiresCompany()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get('current')
  @RequiresPermission('companies:manage', 'invoicing:read')
  @ApiOperation({ summary: 'The invoice header data of the current company' })
  @ApiOkResponse({ type: CompanyDto })
  current(): Promise<CompanyDto> {
    return this.companies.current();
  }

  @Put('current')
  @RequiresPermission('companies:manage')
  @ApiOperation({ summary: 'Change the invoice header data of the current company' })
  @ApiOkResponse({ type: CompanyDto })
  update(@Body() dto: UpdateCompanyDto): Promise<CompanyDto> {
    return this.companies.update(dto);
  }
}
