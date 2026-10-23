import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  VersionDto,
  WarehouseDto,
  WarehousePageDto,
  WarehousesQuery,
} from './warehouses.dto.js';
import { WarehousesService } from './warehouses.service.js';

/** The header every warehouse route needs: the company it works on (S5). */
export const COMPANY_HEADER = ApiHeader({
  name: 'X-Company-Id',
  required: true,
  description: 'The company to work on, one the person can reach',
});

@ApiTags('warehouse')
@ApiBearerAuth()
@COMPANY_HEADER
@RequiresModule('warehouse')
@RequiresCompany()
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @RequiresPermission('stock:read')
  @ApiOperation({ summary: 'Warehouses of the company' })
  @ApiOkResponse({ type: WarehousePageDto })
  list(@Query() query: WarehousesQuery): Promise<WarehousePageDto> {
    return this.warehouses.list(query);
  }

  @Get(':id')
  @RequiresPermission('stock:read')
  @ApiOkResponse({ type: WarehouseDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<WarehouseDto> {
    return this.warehouses.get(id);
  }

  @Post()
  @RequiresPermission('warehouses:manage')
  @ApiCreatedResponse({ type: WarehouseDto })
  create(@Body() body: CreateWarehouseDto): Promise<WarehouseDto> {
    return this.warehouses.create(body);
  }

  @Patch(':id')
  @RequiresPermission('warehouses:manage')
  @ApiOperation({ summary: 'Rename; 409 EDIT_CONFLICT if the version is old' })
  @ApiOkResponse({ type: WarehouseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWarehouseDto,
  ): Promise<WarehouseDto> {
    return this.warehouses.update(id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('warehouses:manage')
  @ApiOperation({ summary: 'Archive an empty warehouse; 409 WAREHOUSE_NOT_EMPTY otherwise' })
  @ApiOkResponse({ type: WarehouseDto })
  archive(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto): Promise<WarehouseDto> {
    return this.warehouses.archive(id, body.version);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('warehouses:manage')
  @ApiOkResponse({ type: WarehouseDto })
  restore(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto): Promise<WarehouseDto> {
    return this.warehouses.restore(id, body.version);
  }
}
