import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mapChainError } from './chain-error';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string; // stable machine-readable error code (taxonomy)
  traceId: string; // correlates the client error with the server log line
}

/** Minimal shape of the HTTP response we drive — avoids a direct dependency on express types. */
interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: ProblemDetails): unknown;
}

/**
 * Global filter that renders every uncaught error as one RFC-7807-ish JSON shape
 * (`{ type, title, status, detail }`). HttpExceptions keep their status + message;
 * recognized chain/viem errors are mapped to friendly details; anything else is a
 * generic 500 so stack traces and secrets never leak to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const body = this.shape(exception);
    if (body.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Log full detail server-side only; the client gets the generic body + the traceId to report.
      this.logger.error(`[${body.traceId}] ${body.status} ${body.title}: ${(exception as Error)?.message ?? exception}`);
    }
    response.status(body.status).json(body);
  }

  private shape(exception: unknown): ProblemDetails {
    const traceId = randomBytes(4).toString('hex');
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const detail = detailOf(exception);
      return { type: 'about:blank', title: this.titleFor(status), status, detail, code: codeFor(status, detail), traceId };
    }
    const mapped = mapChainError(exception);
    if (mapped) {
      return { type: 'about:blank', title: this.titleFor(mapped.status), status: mapped.status, detail: mapped.detail, code: mapped.code, traceId };
    }
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    return { type: 'about:blank', title: this.titleFor(status), status, detail: 'Internal server error', code: 'INTERNAL', traceId };
  }

  private titleFor(status: number): string {
    return HttpStatus[status] ? String(HttpStatus[status]) : 'Error';
  }
}

/** Pull the human-readable message out of an HttpException's response payload. */
function detailOf(exception: HttpException): string {
  const res = exception.getResponse();
  if (typeof res === 'string') return res;
  const message = (res as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string') return message;
  return exception.message;
}

/** Map a status + detail to a stable, machine-readable error code (the error taxonomy). */
function codeFor(status: number, detail: string): string {
  if (status === HttpStatus.FORBIDDEN) return /policy/i.test(detail) ? 'POLICY_VIOLATION' : 'FORBIDDEN';
  if (status === HttpStatus.BAD_REQUEST) return /address/i.test(detail) ? 'INVALID_ADDRESS' : 'BAD_REQUEST';
  if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHORIZED';
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  if (status === HttpStatus.CONFLICT) return 'CONFLICT';
  return HttpStatus[status] ? String(HttpStatus[status]) : 'ERROR';
}
