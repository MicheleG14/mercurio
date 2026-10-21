import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** An optional text field: absent leaves it as it is, null or blank empties it. */
export const Text = (maxLength: number, example?: string) =>
  applyDecorators(
    ApiPropertyOptional({ type: String, nullable: true, maxLength, example }),
    IsOptional(),
    IsString(),
    MaxLength(maxLength),
  );
