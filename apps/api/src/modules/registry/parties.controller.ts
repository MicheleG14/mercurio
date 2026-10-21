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
import {
  CreatePartyDto,
  PartiesQuery,
  PartyDto,
  PartyLookupDto,
  PartyLookupQuery,
  PartyPageDto,
  UpdatePartyDto,
  VersionDto,
} from './parties.dto.js';
import { PartiesService } from './parties.service.js';

// Shared by all the companies of the tenant (S3): no route needs X-Company-Id.
@ApiTags('registry')
@ApiBearerAuth()
@RequiresModule('registry')
@Controller('parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get()
  @RequiresPermission('parties:read')
  @ApiOperation({ summary: 'Customers and suppliers, searched, filtered and paginated' })
  @ApiOkResponse({ type: PartyPageDto })
  list(@Query() query: PartiesQuery): Promise<PartyPageDto> {
    return this.parties.list(query);
  }

  // Declared before ':id', so that "lookup" is not taken for an id.
  @Get('lookup')
  @RequiresPermission('parties:read')
  @ApiOperation({ summary: 'Parties, archived ones too, with a VAT number or a tax code' })
  @ApiOkResponse({ type: PartyLookupDto })
  lookup(@Query() query: PartyLookupQuery): Promise<PartyLookupDto> {
    return this.parties.lookup(query);
  }

  @Get(':id')
  @RequiresPermission('parties:read')
  @ApiOkResponse({ type: PartyDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PartyDto> {
    return this.parties.get(id);
  }

  @Post()
  @RequiresPermission('parties:write')
  @ApiCreatedResponse({ type: PartyDto })
  create(@Body() body: CreatePartyDto): Promise<PartyDto> {
    return this.parties.create(body);
  }

  @Patch(':id')
  @RequiresPermission('parties:write')
  @ApiOperation({ summary: 'Change the fields sent; 409 EDIT_CONFLICT if the version is old' })
  @ApiOkResponse({ type: PartyDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePartyDto): Promise<PartyDto> {
    return this.parties.update(id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('parties:write')
  @ApiOkResponse({ type: PartyDto })
  archive(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto): Promise<PartyDto> {
    return this.parties.archive(id, body.version);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('parties:write')
  @ApiOkResponse({ type: PartyDto })
  restore(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto): Promise<PartyDto> {
    return this.parties.restore(id, body.version);
  }
}
