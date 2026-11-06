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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequiresPermission } from '../identity/index.js';
import { PageQuery } from '../../shared/pagination.js';
import {
  ActivationCodeDto,
  AddedMemberDto,
  AddMemberDto,
  MemberDto,
  MemberPageDto,
  UpdateMemberDto,
  VersionDto,
} from './members.dto.js';
import { MembersService } from './members.service.js';

/**
 * The people of the current tenant. Not part of a sellable module: every tenant administers its
 * people, so there is no @RequiresModule.
 */
@ApiTags('members')
@ApiBearerAuth()
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequiresPermission('members:read')
  @ApiOperation({ summary: 'People of the tenant; q searches name and email' })
  @ApiOkResponse({ type: MemberPageDto })
  list(@Query() query: PageQuery): Promise<MemberPageDto> {
    return this.members.list(query);
  }

  @Get(':id')
  @RequiresPermission('members:read')
  @ApiOkResponse({ type: MemberDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<MemberDto> {
    return this.members.get(id);
  }

  @Post()
  @RequiresPermission('members:manage')
  @ApiOperation({
    summary: 'Add a person; a new identity gets an activation code, returned only here',
  })
  @ApiCreatedResponse({ type: AddedMemberDto })
  add(@Body() body: AddMemberDto): Promise<AddedMemberDto> {
    return this.members.add(body);
  }

  @Patch(':id')
  @RequiresPermission('members:manage')
  @ApiOperation({
    summary: 'Change role or companies; never of oneself, never the last administrator',
  })
  @ApiOkResponse({ type: MemberDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMemberDto,
  ): Promise<MemberDto> {
    return this.members.update(id, body);
  }

  @Post(':id/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresPermission('members:manage')
  @ApiOperation({ summary: 'Remove from the tenant; the person and their history stay' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() body: VersionDto): Promise<void> {
    return this.members.remove(id, body.version);
  }

  @Post(':id/activation-code')
  @RequiresPermission('members:manage')
  @ApiOperation({
    summary:
      'A new activation code, only for someone who never activated and belongs to no other tenant',
  })
  @ApiCreatedResponse({ type: ActivationCodeDto })
  issueCode(@Param('id', ParseUUIDPipe) id: string): Promise<ActivationCodeDto> {
    return this.members.issueCode(id);
  }
}
