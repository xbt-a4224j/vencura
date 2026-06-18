import { ForbiddenException, HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Build a mocked ArgumentsHost whose HTTP response captures status + json. */
function mockHost() {
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  const response = { status, json };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('shapes an HttpException into an RFC-7807-ish body with its status', () => {
    const { host, status, json } = mockHost();
    filter.catch(new ForbiddenException('policy violation'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(json).toHaveBeenCalledWith({
      type: 'about:blank',
      title: expect.any(String),
      status: HttpStatus.FORBIDDEN,
      detail: 'policy violation',
    });
  });

  it('preserves a 404 HttpException status', () => {
    const { host, status, json } = mockHost();
    filter.catch(new HttpException('not found', HttpStatus.NOT_FOUND), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json.mock.calls[0][0]).toMatchObject({ status: HttpStatus.NOT_FOUND, detail: 'not found' });
  });

  it('maps a recognized chain error to its status + friendly detail', () => {
    const { host, status, json } = mockHost();
    filter.catch(new Error('insufficient funds for gas * price + value'), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0]).toMatchObject({ status: 400, detail: expect.stringMatching(/insufficient funds/i) });
  });

  it('falls back to 500 with a generic detail for an unknown error (no leakage)', () => {
    const { host, status, json } = mockHost();
    filter.catch(new Error('secret stack detail at /Users/secret'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0][0];
    expect(body).toMatchObject({ status: 500, detail: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
