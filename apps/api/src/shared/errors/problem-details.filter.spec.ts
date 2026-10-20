import type { ArgumentsHost } from '@nestjs/common';
import { ForbiddenException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { DomainException } from './domain.exception.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

function respond(exception: unknown) {
  const response = { status: vi.fn(), type: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as ArgumentsHost;

  new ProblemDetailsFilter().catch(exception, host);
  return {
    status: response.status.mock.calls[0]?.[0] as number,
    contentType: response.type.mock.calls[0]?.[0] as string,
    body: response.json.mock.calls[0]?.[0] as Record<string, unknown>,
  };
}

describe('ProblemDetailsFilter', () => {
  it('turns a domain exception into Problem Details with its code', () => {
    const res = respond(
      new DomainException('MODULE_NOT_ENABLED', HttpStatus.FORBIDDEN, { detail: 'warehouse' }),
    );

    expect(res.status).toBe(403);
    expect(res.contentType).toBe('application/problem+json');
    expect(res.body).toEqual({
      type: 'about:blank',
      status: 403,
      title: 'Forbidden',
      code: 'MODULE_NOT_ENABLED',
      detail: 'warehouse',
    });
  });

  it('keeps field errors of validation failures', () => {
    const res = respond(
      new DomainException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
        errors: [{ field: 'email', code: 'IS_EMAIL' }],
      }),
    );

    expect(res.body).toMatchObject({ status: 400, errors: [{ field: 'email', code: 'IS_EMAIL' }] });
  });

  it.each([
    [new NotFoundException(), 404, 'NOT_FOUND'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new ThrottlerException(), 429, 'RATE_LIMITED'],
  ])('gives framework errors a code from their status (%#)', (exception, status, code) => {
    expect(respond(exception).body).toMatchObject({ status, code });
  });

  it('keeps the status of client errors raised outside Nest, such as malformed JSON', () => {
    const parserError = Object.assign(new SyntaxError('Unexpected token'), { status: 400 });

    expect(respond(parserError).body).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
  });

  it('answers unexpected errors with a generic 500 and logs them', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const res = respond(new Error('connection string postgresql://secret@db'));

    expect(res.body).toEqual({
      type: 'about:blank',
      status: 500,
      title: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
