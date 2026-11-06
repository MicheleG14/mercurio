import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BUILTIN_ROLES, PERMISSIONS, RoleRefDto } from '../identity/index.js';

// --- requests --------------------------------------------------------------------------------

/** Exactly one of the two: a built-in role by key, or a custom role of the tenant by id. */
export class RoleChoiceDto {
  @ApiPropertyOptional({ enum: BUILTIN_ROLES })
  @IsOptional()
  @IsIn(BUILTIN_ROLES)
  builtin?: (typeof BUILTIN_ROLES)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customRoleId?: string;
}

export class VersionDto {
  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class AddMemberDto {
  @ApiProperty({ example: 'mario.bianchi@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'Mario Bianchi',
    description: 'Ignored when the person already has an account',
  })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ type: RoleChoiceDto })
  @ValidateNested()
  @Type(() => RoleChoiceDto)
  role!: RoleChoiceDto;

  @ApiProperty({ description: 'Every company of the tenant, now and later' })
  @IsBoolean()
  allCompanies!: boolean;

  @ApiProperty({ type: [String], description: 'The companies reached when allCompanies is false' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  companyIds!: string[];
}

/** Role, companies or both; what is absent stays as it is. */
export class UpdateMemberDto extends VersionDto {
  @ApiPropertyOptional({ type: RoleChoiceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RoleChoiceDto)
  role?: RoleChoiceDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allCompanies?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  companyIds?: string[];
}

export class RoleInputDto {
  @ApiProperty({ example: 'Commerciale', maxLength: 60 })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string | null;

  @ApiProperty({ type: [String], enum: PERMISSIONS, example: ['parties:read', 'parties:write'] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  permissions!: string[];
}

export class CreateRoleDto extends RoleInputDto {
  @ApiPropertyOptional({
    enum: BUILTIN_ROLES,
    description: 'The built-in role it was duplicated from',
  })
  @IsOptional()
  @IsIn(BUILTIN_ROLES)
  basedOn?: (typeof BUILTIN_ROLES)[number];
}

export class UpdateRoleDto extends RoleInputDto {
  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

// --- responses -------------------------------------------------------------------------------

export class MemberDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: RoleRefDto }) role!: RoleRefDto;
  @ApiProperty() allCompanies!: boolean;
  @ApiProperty({ type: [String] }) companyIds!: string[];
  @ApiProperty({ enum: ['ACTIVE', 'PENDING_ACTIVATION'] }) status!: 'ACTIVE' | 'PENDING_ACTIVATION';
  @ApiProperty({ description: 'A new activation code can be issued from the interface' })
  canIssueCode!: boolean;
  @ApiProperty({ description: 'The signed-in person: no change of role, companies or removal' })
  isSelf!: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Last use of this tenant' })
  lastSeenAt!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty() createdAt!: string;
}

export class MemberPageDto {
  @ApiProperty({ type: [MemberDto] }) items!: MemberDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ActivationCodeDto {
  @ApiProperty({ description: 'Shown once: only its hash is stored' }) code!: string;
  @ApiProperty() expiresAt!: string;
}

export class AddedMemberDto {
  @ApiProperty({ type: MemberDto }) member!: MemberDto;
  @ApiProperty({ type: ActivationCodeDto, nullable: true }) activation!: ActivationCodeDto | null;
  @ApiProperty({ description: 'The person already had a Mercurio account: they sign in with it' })
  existingAccount!: boolean;
}

export class BuiltinRoleDto {
  @ApiProperty({ enum: BUILTIN_ROLES }) key!: (typeof BUILTIN_ROLES)[number];
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty({ description: 'Active members holding it' }) members!: number;
}

export class CustomRoleDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty({ enum: BUILTIN_ROLES, nullable: true, type: String })
  basedOn!: (typeof BUILTIN_ROLES)[number] | null;
  @ApiProperty({ description: 'Active members holding it' }) members!: number;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) archivedAt!: string | null;
  @ApiProperty() updatedAt!: string;
}

export class RoleListDto {
  @ApiProperty({ type: [BuiltinRoleDto] }) builtin!: BuiltinRoleDto[];
  @ApiProperty({ type: [CustomRoleDto] }) custom!: CustomRoleDto[];
}

export class PermissionInfoDto {
  @ApiProperty({ enum: PERMISSIONS }) key!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Null: administration of the tenant' })
  module!: string | null;
  @ApiProperty({ description: 'The tenant has the module: otherwise the permission waits for it' })
  moduleEnabled!: boolean;
  @ApiProperty({ type: [String], description: 'Permissions it needs, directly' })
  requires!: string[];
  @ApiProperty({ description: 'Built-in administrator only: not in a custom role' })
  reserved!: boolean;
}

export class PermissionCatalogDto {
  @ApiProperty({ type: [PermissionInfoDto] }) permissions!: PermissionInfoDto[];
}
