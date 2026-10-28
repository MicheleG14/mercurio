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
import { RequiresCompany } from '../auth/index.js';
import { RequiresPermission } from '../identity/index.js';
import { RequiresModule } from '../tenancy/index.js';
import { FulfilmentsService } from './fulfilments.service.js';
import { OrderActionsService } from './order-actions.service.js';
import { OrderDraftsService } from './order-drafts.service.js';
import { OrderQueriesService } from './order-queries.service.js';
import {
  CloseOrderDto,
  CreateFulfilmentDto,
  CreateOrderDto,
  DuplicateOrderDto,
  IncomingDto,
  IncomingQuery,
  OrderDto,
  OrderItemOptionDto,
  OrderItemSearchQuery,
  OrderPageDto,
  OrderPartyOptionDto,
  OrderPartySearchQuery,
  OrdersQuery,
  OrdersSummaryDto,
  ReorderProposalLineDto,
  ReorderProposalQuery,
  UpdateOrderDto,
  VersionDto,
  VersionQuery,
} from './orders.dto.js';

/** Purchase and sales orders of the company in the header (S5). See docs/adr/0024. */
@ApiTags('orders')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Company-Id',
  required: true,
  description: 'The company to work on, one the person can reach',
})
@RequiresModule('orders')
@RequiresCompany()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly queries: OrderQueriesService,
    private readonly drafts: OrderDraftsService,
    private readonly actions: OrderActionsService,
    private readonly fulfilments: FulfilmentsService,
  ) {}

  @Get()
  @RequiresPermission('orders:read')
  @ApiOperation({ summary: 'Orders of one kind, newest first by default' })
  @ApiOkResponse({ type: OrderPageDto })
  list(@Query() query: OrdersQuery): Promise<OrderPageDto> {
    return this.queries.list(query);
  }

  // Fixed paths before ':id', so that "summary" is never read as an id.
  @Get('summary')
  @RequiresPermission('orders:read')
  @ApiOkResponse({ type: OrdersSummaryDto })
  summary(): Promise<OrdersSummaryDto> {
    return this.queries.summary();
  }

  @Get('items-search')
  @RequiresPermission('orders:read')
  @ApiOperation({ summary: 'Items for an order line, with list price, VAT and free stock' })
  @ApiOkResponse({ type: [OrderItemOptionDto] })
  searchItems(@Query() query: OrderItemSearchQuery): Promise<OrderItemOptionDto[]> {
    return this.queries.searchItems(query);
  }

  @Get('parties-search')
  @RequiresPermission('orders:read')
  @ApiOperation({ summary: 'Suppliers or customers for an order of this kind' })
  @ApiOkResponse({ type: [OrderPartyOptionDto] })
  searchParties(@Query() query: OrderPartySearchQuery): Promise<OrderPartyOptionDto[]> {
    return this.queries.searchParties(query);
  }

  @Get('incoming')
  @RequiresPermission('orders:read')
  @ApiOperation({ summary: 'What open purchase orders still bring of an item' })
  @ApiOkResponse({ type: IncomingDto })
  incoming(@Query() query: IncomingQuery): Promise<IncomingDto> {
    return this.queries.incoming(query.itemId);
  }

  @Get('reorder-proposal')
  @RequiresPermission('orders:read')
  @ApiOperation({ summary: 'Lines for a purchase order: items below reorder, less incoming' })
  @ApiOkResponse({ type: [ReorderProposalLineDto] })
  reorderProposal(@Query() query: ReorderProposalQuery): Promise<ReorderProposalLineDto[]> {
    return this.queries.reorderProposal(query.warehouseId);
  }

  @Get(':id')
  @RequiresPermission('orders:read')
  @ApiOkResponse({ type: OrderDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDto> {
    return this.queries.get(id);
  }

  @Post()
  @RequiresPermission('orders:write')
  @ApiOperation({
    summary: 'Create a draft',
    description: 'The same id with the same content answers 200 with the draft (B33).',
  })
  @ApiCreatedResponse({ type: OrderDto })
  @ApiOkResponse({ type: OrderDto, description: 'Already created with this id' })
  async create(
    @Body() body: CreateOrderDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDto> {
    const { order, created } = await this.drafts.create(body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return order;
  }

  @Put(':id')
  @RequiresPermission('orders:write')
  @ApiOperation({ summary: 'Save a draft, header and lines; 409 ORDER_NOT_DRAFT once confirmed' })
  @ApiOkResponse({ type: OrderDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateOrderDto): Promise<OrderDto> {
    return this.drafts.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresPermission('orders:write')
  @ApiOperation({ summary: 'Delete a draft' })
  @ApiNoContentResponse()
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: VersionQuery,
  ): Promise<void> {
    await this.drafts.remove(id, query.version);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('orders:write')
  @ApiOperation({ summary: 'Number the order; a sales order reserves what is available' })
  @ApiOkResponse({ type: OrderDto })
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto): Promise<OrderDto> {
    return this.actions.confirm(id, body.version);
  }

  @Post(':id/reserve')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('orders:write')
  @ApiOperation({ summary: 'Reserve what is now available for the uncovered lines' })
  @ApiOkResponse({ type: OrderDto })
  reserve(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDto> {
    return this.actions.reserve(id);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('orders:write')
  @ApiOperation({ summary: 'Close what is left of some lines, or all; releases reservations' })
  @ApiOkResponse({ type: OrderDto })
  close(@Param('id', ParseUUIDPipe) id: string, @Body() body: CloseOrderDto): Promise<OrderDto> {
    return this.actions.close(id, body.version, body.lineIds);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('orders:write')
  @ApiOperation({ summary: 'Cancel a confirmed order nothing has moved for' })
  @ApiOkResponse({ type: OrderDto })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto): Promise<OrderDto> {
    return this.actions.cancel(id, body.version);
  }

  @Post(':id/duplicate')
  @RequiresPermission('orders:write')
  @ApiOperation({ summary: 'A new draft with the same lines and prices' })
  @ApiCreatedResponse({ type: OrderDto })
  @ApiOkResponse({ type: OrderDto, description: 'Already duplicated with this id' })
  async duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DuplicateOrderDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDto> {
    const { order, created } = await this.drafts.duplicate(id, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return order;
  }

  @Post(':id/fulfilments')
  @RequiresPermission('orders:fulfil')
  @ApiOperation({
    summary: 'Receive or ship some lines; 409 QUANTITY_OVER_REMAINING, STOCK_INSUFFICIENT',
    description: 'The same id with the same lines answers 200 (B33).',
  })
  @ApiCreatedResponse({ type: OrderDto })
  @ApiOkResponse({ type: OrderDto, description: 'Already recorded with this id' })
  async fulfil(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateFulfilmentDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDto> {
    const { order, created } = await this.fulfilments.fulfil(id, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return order;
  }

  @Post(':id/fulfilments/:fulfilmentId/reverse')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('orders:fulfil')
  @ApiOperation({ summary: 'Undo a receipt or a shipment: its stock document is reversed' })
  @ApiOkResponse({ type: OrderDto })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fulfilmentId', ParseUUIDPipe) fulfilmentId: string,
  ): Promise<OrderDto> {
    return this.fulfilments.reverse(id, fulfilmentId);
  }
}
