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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequiresPermission } from '../identity/index.js';
import { RequiresModule } from '../tenancy/index.js';
import { CreateItemDto, ItemDto, ItemPageDto, ItemsQuery, UpdateItemDto } from './items.dto.js';
import { ItemsService } from './items.service.js';
import { VersionDto } from './parties.dto.js';

@ApiTags('registry')
@ApiBearerAuth()
@RequiresModule('registry')
@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequiresPermission('items:read')
  @ApiOperation({ summary: 'Items, searched, filtered and paginated' })
  @ApiOkResponse({ type: ItemPageDto })
  list(@Query() query: ItemsQuery): Promise<ItemPageDto> {
    return this.items.list(query);
  }

  @Get(':id')
  @RequiresPermission('items:read')
  @ApiOkResponse({ type: ItemDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ItemDto> {
    return this.items.get(id);
  }

  @Post()
  @RequiresPermission('items:write')
  @ApiCreatedResponse({ type: ItemDto })
  create(@Body() body: CreateItemDto): Promise<ItemDto> {
    return this.items.create(body);
  }

  @Patch(':id')
  @RequiresPermission('items:write')
  @ApiOperation({ summary: 'Change the fields sent; 409 EDIT_CONFLICT if the version is old' })
  @ApiOkResponse({ type: ItemDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateItemDto): Promise<ItemDto> {
    return this.items.update(id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('items:write')
  @ApiOkResponse({ type: ItemDto })
  archive(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto): Promise<ItemDto> {
    return this.items.archive(id, body.version);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('items:write')
  @ApiOkResponse({ type: ItemDto })
  restore(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto): Promise<ItemDto> {
    return this.items.restore(id, body.version);
  }
}
