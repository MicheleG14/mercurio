import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequiresCompany } from '../auth/index.js';
import { RequiresPermission } from '../identity/index.js';
import { RequiresModule } from '../tenancy/index.js';
import {
  ItemOptionDto,
  ItemSearchQuery,
  ItemStockDto,
  MovementPageDto,
  MovementsQuery,
  PartyOptionDto,
  PartySearchQuery,
  ReorderLevelDto,
  RemoveReorderLevelQuery,
  SetReorderLevelDto,
  StockPageDto,
  StockQuery,
  StockSummaryDto,
} from './stock.dto.js';
import { StockService } from './stock.service.js';
import { COMPANY_HEADER } from './warehouses.controller.js';

@ApiTags('warehouse')
@ApiBearerAuth()
@COMPANY_HEADER
@RequiresModule('warehouse')
@RequiresCompany()
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @RequiresPermission('stock:read')
  @ApiOperation({ summary: 'Stock per item, searched, filtered and paginated' })
  @ApiOkResponse({ type: StockPageDto })
  list(@Query() query: StockQuery): Promise<StockPageDto> {
    return this.stock.list(query);
  }

  @Get('summary')
  @RequiresPermission('stock:read')
  @ApiOperation({ summary: 'Counters for the overview' })
  @ApiOkResponse({ type: StockSummaryDto })
  summary(): Promise<StockSummaryDto> {
    return this.stock.summary();
  }

  @Get('items-search')
  @RequiresPermission('stock:read')
  @ApiOperation({ summary: 'Items that can go on a document line (at most 20)' })
  @ApiOkResponse({ type: [ItemOptionDto] })
  searchItems(@Query() query: ItemSearchQuery): Promise<ItemOptionDto[]> {
    return this.stock.searchItems(query);
  }

  @Get('parties-search')
  @RequiresPermission('stock:read')
  @ApiOperation({ summary: 'Active suppliers or customers for a document (at most 20)' })
  @ApiOkResponse({ type: [PartyOptionDto] })
  searchParties(@Query() query: PartySearchQuery): Promise<PartyOptionDto[]> {
    return this.stock.searchParties(query);
  }

  @Get('items/:itemId')
  @RequiresPermission('stock:read')
  @ApiOperation({ summary: 'Stock and reorder levels of an item in each warehouse' })
  @ApiOkResponse({ type: ItemStockDto })
  item(@Param('itemId', ParseUUIDPipe) itemId: string): Promise<ItemStockDto> {
    return this.stock.item(itemId);
  }

  @Get('items/:itemId/movements')
  @RequiresPermission('stock:read')
  @ApiOperation({ summary: 'Movements of an item, newest first, with the stock after each' })
  @ApiOkResponse({ type: MovementPageDto })
  movements(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() query: MovementsQuery,
  ): Promise<MovementPageDto> {
    return this.stock.movements(itemId, query);
  }

  @Put('reorder-levels/:warehouseId/:itemId')
  @RequiresPermission('stock:write')
  @ApiOperation({ summary: 'Set the reorder level; 409 EDIT_CONFLICT if the version is old' })
  @ApiOkResponse({ type: ReorderLevelDto })
  setReorderLevel(
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: SetReorderLevelDto,
  ): Promise<ReorderLevelDto> {
    return this.stock.setReorderLevel(warehouseId, itemId, body);
  }

  @Delete('reorder-levels/:warehouseId/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresPermission('stock:write')
  @ApiNoContentResponse()
  async removeReorderLevel(
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() query: RemoveReorderLevelQuery,
  ): Promise<void> {
    await this.stock.removeReorderLevel(warehouseId, itemId, query.version);
  }
}
