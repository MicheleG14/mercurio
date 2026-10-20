import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainException } from './domain.exception.js';
import {
  codeForStatus,
  PROBLEM_CONTENT_TYPE,
  problem,
  type ProblemDetails,
} from './problem-details.js';

/**
 * The single place where errors become HTTP responses: every error leaves the API as
 * RFC 9457 Problem Details with a stable `code` (docs/adr/0003). Unexpected errors are logged
 * with their stack and answered with a generic 500 that reveals nothing about the cause.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toProblem(exception);
    if (body.status === 429) standardRetryAfter(response);
    response.status(body.status).type(PROBLEM_CONTENT_TYPE).json(body);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof DomainException) {
      return problem(exception.status, exception.code, {
        detail: exception.detail,
        errors: exception.errors,
      });
    }
    if (exception instanceof HttpException) {
      return problem(exception.getStatus(), codeForStatus(exception.getStatus()));
    }
    // Errors raised before Nest (e.g. the JSON body parser) carry an HTTP status of their own.
    const status = clientErrorStatus(exception);
    if (status) return problem(status, codeForStatus(status));

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return problem(500, codeForStatus(500));
  }
}

/**
 * The throttler names its header after the limit that was hit (`Retry-After-strict`). Clients
 * look for the standard `Retry-After`, so the first one found is repeated under that name.
 */
function standardRetryAfter(response: Response): void {
  if (response.getHeader('Retry-After') !== undefined) return;
  const named = Object.keys(response.getHeaders()).find((name) => name.startsWith('retry-after-'));
  const value = named && response.getHeader(named);
  if (value !== undefined) response.setHeader('Retry-After', value);
}

function clientErrorStatus(exception: unknown): number | undefined {
  const status = (exception as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}
