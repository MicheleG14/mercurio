import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../modules/auth/index.js';
import { HealthResponseDto } from './health.dto.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto, description: 'The API and its database are reachable' })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto, description: 'A dependency is down' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponseDto> {
    const report = await this.health.check();
    if (report.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
