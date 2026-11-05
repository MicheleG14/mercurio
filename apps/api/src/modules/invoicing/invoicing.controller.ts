import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PageQuery } from '../../shared/pagination.js';
import { RequiresCompany } from '../auth/index.js';
import { RequiresPermission } from '../identity/index.js';
import { RequiresModule } from '../tenancy/index.js';
import { InvoiceDraftsService } from './invoice-drafts.service.js';
import { InvoiceIssueService } from './invoice-issue.service.js';
import { InvoiceQueriesService } from './invoice-queries.service.js';
import {
  CreateCreditNoteDto,
  CreateDraftDto,
  CustomerOptionDto,
  InvoiceDraftDto,
  InvoiceDraftPageDto,
  InvoiceDto,
  InvoiceItemOptionDto,
  InvoicePageDto,
  InvoicesQuery,
  IssueDto,
  SearchQuery,
  ToInvoicePageDto,
  ToInvoiceQuery,
  UpdateDraftDto,
  VersionQuery,
} from './invoicing.dto.js';

const COMPANY_HEADER = ApiHeader({
  name: 'X-Company-Id',
  required: true,
  description: 'The company to work on, one the person can reach',
});

/** Issued invoices and credit notes: read, and corrected only by a credit note (B37). */
@ApiTags('invoicing')
@ApiBearerAuth()
@COMPANY_HEADER
@RequiresModule('invoicing')
@RequiresCompany()
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly queries: InvoiceQueriesService,
    private readonly drafts: InvoiceDraftsService,
  ) {}

  @Get()
  @RequiresPermission('invoicing:read')
  @ApiOperation({ summary: 'Issued invoices and credit notes, newest first' })
  @ApiOkResponse({ type: InvoicePageDto })
  list(@Query() query: InvoicesQuery): Promise<InvoicePageDto> {
    return this.queries.listInvoices(query);
  }

  @Get(':id')
  @RequiresPermission('invoicing:read')
  @ApiOkResponse({ type: InvoiceDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<InvoiceDto> {
    return this.queries.getInvoice(id);
  }

  @Post(':id/credit-note')
  @RequiresPermission('invoicing:write')
  @ApiOperation({
    summary: 'A draft credit note: what is left of the chosen lines of the invoice, or of all',
  })
  @ApiCreatedResponse({ type: InvoiceDraftDto })
  @ApiOkResponse({ type: InvoiceDraftDto, description: 'Already created with this id' })
  async creditNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateCreditNoteDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InvoiceDraftDto> {
    const { draft, created } = await this.drafts.creditNote(id, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return draft;
  }
}

/** Drafts of invoices and credit notes: free to change until they are issued. */
@ApiTags('invoicing')
@ApiBearerAuth()
@COMPANY_HEADER
@RequiresModule('invoicing')
@RequiresCompany()
@Controller('invoice-drafts')
export class InvoiceDraftsController {
  constructor(
    private readonly queries: InvoiceQueriesService,
    private readonly drafts: InvoiceDraftsService,
    private readonly issuing: InvoiceIssueService,
  ) {}

  @Get()
  @RequiresPermission('invoicing:read')
  @ApiOkResponse({ type: InvoiceDraftPageDto })
  list(@Query() query: PageQuery): Promise<InvoiceDraftPageDto> {
    return this.queries.listDraftsOf(query);
  }

  @Post()
  @RequiresPermission('invoicing:write')
  @ApiOperation({
    summary: 'Create a draft invoice, by hand or from shipments of one customer',
    description: 'The same id again answers 200 with the draft (B33).',
  })
  @ApiCreatedResponse({ type: InvoiceDraftDto })
  @ApiOkResponse({ type: InvoiceDraftDto, description: 'Already created with this id' })
  async create(
    @Body() body: CreateDraftDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InvoiceDraftDto> {
    const { draft, created } = await this.drafts.create(body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return draft;
  }

  @Get(':id')
  @RequiresPermission('invoicing:read')
  @ApiOkResponse({ type: InvoiceDraftDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<InvoiceDraftDto> {
    return this.queries.getDraft(id);
  }

  @Put(':id')
  @RequiresPermission('invoicing:write')
  @ApiOperation({ summary: 'Save a draft, header and lines' })
  @ApiOkResponse({ type: InvoiceDraftDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDraftDto,
  ): Promise<InvoiceDraftDto> {
    return this.drafts.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresPermission('invoicing:write')
  @ApiOperation({ summary: 'Delete a draft; its shipments are to invoice again' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string, @Query() query: VersionQuery): Promise<void> {
    return this.drafts.remove(id, query.version);
  }

  @Post(':id/issue')
  @RequiresPermission('invoicing:issue')
  @ApiOperation({
    summary: 'Issue a draft: number, due dates; from now on it never changes',
    description: 'Issuing it again answers 200 with the document already issued (B33).',
  })
  @ApiCreatedResponse({ type: InvoiceDto })
  @ApiOkResponse({ type: InvoiceDto, description: 'Already issued' })
  async issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IssueDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InvoiceDto> {
    const { invoice, created } = await this.issuing.issue(id, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return invoice;
  }
}

/** What invoicing needs around its documents: shipments to invoice, customers, items. */
@ApiTags('invoicing')
@ApiBearerAuth()
@COMPANY_HEADER
@RequiresModule('invoicing')
@RequiresCompany()
@Controller('invoicing')
export class InvoicingController {
  constructor(private readonly queries: InvoiceQueriesService) {}

  @Get('to-invoice')
  @RequiresPermission('invoicing:read')
  @ApiOperation({ summary: 'Shipments of sales orders not yet invoiced, oldest first' })
  @ApiOkResponse({ type: ToInvoicePageDto })
  toInvoice(@Query() query: ToInvoiceQuery): Promise<ToInvoicePageDto> {
    return this.queries.listToInvoice(query);
  }

  @Get('parties-search')
  @RequiresPermission('invoicing:read')
  @ApiOperation({ summary: 'Active customers for an invoice' })
  @ApiOkResponse({ type: [CustomerOptionDto] })
  searchParties(@Query() query: SearchQuery): Promise<CustomerOptionDto[]> {
    return this.queries.searchCustomers(query.q);
  }

  @Get('items-search')
  @RequiresPermission('invoicing:read')
  @ApiOperation({ summary: 'Active items and services for a line of an invoice' })
  @ApiOkResponse({ type: [InvoiceItemOptionDto] })
  searchItems(@Query() query: SearchQuery): Promise<InvoiceItemOptionDto[]> {
    return this.queries.searchItems(query.q);
  }
}
