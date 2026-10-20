import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsPositive, ValidateNested } from 'class-validator';
import { DomainException } from '../../src/shared/errors/index.js';

// Test-only endpoints, mounted by the e2e tests next to AppModule: they exercise behaviour
// (validation, domain errors) that no production endpoint triggers yet. Never shipped.
class ProbeLineDto {
  @IsInt()
  @IsPositive()
  quantity!: number;
}

class ProbeBodyDto {
  @IsEmail()
  email!: string;

  @ValidateNested({ each: true })
  @Type(() => ProbeLineDto)
  lines!: ProbeLineDto[];
}

@Controller('probe')
export class ProbeController {
  @Post('validate')
  validate(@Body() body: ProbeBodyDto): { ok: true; lines: number } {
    return { ok: true, lines: body.lines.length };
  }

  @Post('domain-error')
  domainError(): never {
    throw new DomainException('PROBE_RULE_BROKEN', HttpStatus.CONFLICT);
  }

  @Post('crash')
  crash(): never {
    throw new Error('unexpected failure with internal details');
  }
}
