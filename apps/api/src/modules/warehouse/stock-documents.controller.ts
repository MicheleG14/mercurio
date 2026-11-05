import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RequiresCompany } from '../auth/index.js';
import { RequiresPermission } from '../identity/index.js';
import { RequiresModule } from '../tenancy/index.js';
import {
  CreateStockDocumentDto,
  StockDocumentDto,
  StockDocumentPageDto,
  StockDocumentsQuery,
} from './stock-documents.dto.js';
import { DeliveryNoteService } from './delivery-note.js';
import { StockDocumentsService } from './stock-documents.service.js';
import { COMPANY_HEADER } from './warehouses.controller.js';

@ApiTags('warehouse')
@ApiBearerAuth()
@COMPANY_HEADER
@RequiresModule('warehouse')
@RequiresCompany()
@Controller('stock-documents')
export class StockDocumentsController {
  constructor(
    private readonly documents: StockDocumentsService,
    private readonly deliveryNotes: DeliveryNoteService,
  ) {}

  @Get()
  @RequiresPermission('stock:read')
  @ApiOperation({ summary: 'Stock documents of the company, newest first by default' })
  @ApiOkResponse({ type: StockDocumentPageDto })
  list(@Query() query: StockDocumentsQuery): Promise<StockDocumentPageDto> {
    return this.documents.list(query);
  }

  @Get(':id/delivery-note.pdf')
  @RequiresPermission('stock:read')
  @ApiOperation({ summary: 'The delivery note (DDT) of a sale, in PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'The delivery note in PDF',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  async deliveryNote(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const file = await this.deliveryNotes.print(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.bytes);
  }

  @Get(':id')
  @RequiresPermission('stock:read')
  @ApiOkResponse({ type: StockDocumentDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<StockDocumentDto> {
    return this.documents.get(id);
  }

  @Post()
  @RequiresPermission('stock:write')
  @ApiOperation({
    summary: 'Record a document; 409 STOCK_INSUFFICIENT if stock would go below zero',
    description:
      'The same id with the same content answers 200 with the document already recorded (B33).',
  })
  @ApiCreatedResponse({ type: StockDocumentDto })
  @ApiOkResponse({ type: StockDocumentDto, description: 'Already recorded with this id' })
  async create(
    @Body() body: CreateStockDocumentDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StockDocumentDto> {
    const { document, created } = await this.documents.post(body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return document;
  }

  @Post(':id/reverse')
  @RequiresPermission('stock:write')
  @ApiOperation({ summary: 'Reverse a document; 409 ALREADY_REVERSED the second time' })
  @ApiCreatedResponse({ type: StockDocumentDto })
  reverse(@Param('id', ParseUUIDPipe) id: string): Promise<StockDocumentDto> {
    return this.documents.reverse(id);
  }
}
