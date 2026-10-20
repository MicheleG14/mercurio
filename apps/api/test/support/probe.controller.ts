import { Body, Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsPositive, ValidateNested } from 'class-validator';
import { Public } from '../../src/modules/auth/index.js';
import { RequiresModule } from '../../src/modules/tenancy/index.js';
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

// Open to everyone: these tests exercise validation, errors and the module guard in isolation,
// not signing in (that has its own tests).
@Public()
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

  @Get('warehouse')
  @RequiresModule('warehouse')
  warehouse(): { ok: true } {
    return { ok: true };
  }
}
