import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequiresCompany } from '../auth/index.js';
import { RequiresPermission } from '../identity/index.js';
import { RequiresModule } from '../tenancy/index.js';
import { CompaniesService } from './companies.service.js';
import { CompanyDto, CompanyListDto, CreateCompanyDto, UpdateCompanyDto } from './companies.dto.js';

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

/**
 * The companies of the tenant as a whole: no X-Company-Id, because listing them and adding one
 * are not work on one company.
 */
@ApiTags('registry')
@ApiBearerAuth()
@RequiresModule('registry')
@Controller('companies')
export class CompanyListController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequiresPermission('companies:manage')
  @ApiOperation({ summary: 'The companies the person reaches' })
  @ApiOkResponse({ type: CompanyListDto })
  list(): Promise<CompanyListDto> {
    return this.companies.list();
  }

  @Post()
  @RequiresPermission('companies:manage')
  @ApiOperation({
    summary: 'Add a company of the group; the same id and data again return it (B33)',
  })
  @ApiCreatedResponse({ type: CompanyDto })
  create(@Body() body: CreateCompanyDto): Promise<CompanyDto> {
    return this.companies.create(body);
  }
}
