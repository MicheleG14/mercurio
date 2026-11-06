import { ApiProperty } from '@nestjs/swagger';
import { BUILTIN_ROLES, type RoleRef } from './roles.js';

/**
 * A role as the interface receives it: a built-in one by key (translated in the interface), or a
 * custom one by id and name (written by the tenant, shown as it is).
 */
export class RoleRefDto {
  @ApiProperty({ enum: ['builtin', 'custom'] }) kind!: 'builtin' | 'custom';
  @ApiProperty({ enum: BUILTIN_ROLES, nullable: true, type: String })
  key!: (typeof BUILTIN_ROLES)[number] | null;
  @ApiProperty({ type: String, nullable: true }) id!: string | null;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
}

export function toRoleRefDto(role: RoleRef): RoleRefDto {
  return role.kind === 'builtin'
    ? { kind: 'builtin', key: role.key, id: null, name: null }
    : { kind: 'custom', key: null, id: role.id, name: role.name };
}
