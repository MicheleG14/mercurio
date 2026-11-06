import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequiresPermission } from '../identity/index.js';
import {
  CreateRoleDto,
  CustomRoleDto,
  PermissionCatalogDto,
  RoleListDto,
  UpdateRoleDto,
  VersionDto,
} from './members.dto.js';
import { MembersService } from './members.service.js';

/** Built-in roles (read only) and the roles the tenant defines for itself (docs/adr/0036). */
@ApiTags('members')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequiresPermission('members:read')
  @ApiOperation({ summary: 'Built-in roles and the custom roles in use' })
  @ApiOkResponse({ type: RoleListDto })
  list(): Promise<RoleListDto> {
    return this.members.roles();
  }

  @Get('catalog')
  @RequiresPermission('members:read')
  @ApiOperation({ summary: 'Every permission, with its module and what it needs' })
  @ApiOkResponse({ type: PermissionCatalogDto })
  catalog(): Promise<PermissionCatalogDto> {
    return this.members.catalog();
  }

  @Get(':id')
  @RequiresPermission('members:read')
  @ApiOkResponse({ type: CustomRoleDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CustomRoleDto> {
    return this.members.role(id);
  }

  @Post()
  @RequiresPermission('roles:manage')
  @ApiCreatedResponse({ type: CustomRoleDto })
  create(@Body() body: CreateRoleDto): Promise<CustomRoleDto> {
    return this.members.createRole(body);
  }

  @Put(':id')
  @RequiresPermission('roles:manage')
  @ApiOperation({ summary: 'Name, description and permissions; 409 EDIT_CONFLICT if outdated' })
  @ApiOkResponse({ type: CustomRoleDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRoleDto,
  ): Promise<CustomRoleDto> {
    return this.members.updateRole(id, body);
  }

  @Post(':id/archive')
  @RequiresPermission('roles:manage')
  @ApiOperation({ summary: 'Archive a role nobody holds (409 ROLE_IN_USE otherwise)' })
  @ApiOkResponse({ type: CustomRoleDto })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VersionDto,
  ): Promise<CustomRoleDto> {
    return this.members.archiveRole(id, body.version);
  }
}
