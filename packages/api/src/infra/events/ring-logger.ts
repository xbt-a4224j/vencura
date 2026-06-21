import { ConsoleLogger } from '@nestjs/common';
import type { EventsService, LogLine } from './events.service';

// Nest's own framework logs (route mapping, DI bootstrap, etc.) — kept OUT of the in-app live log
// so it stays operational signal (nonce acquired, tx broadcast, confirmations) rather than noise.
const FRAMEWORK_CONTEXTS = new Set([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'NestFactory',
  'NestApplication',
  'NestMicroservice',
  'WebSocketsController',
  'ExceptionsHandler',
]);

/**
 * Tees the NestJS logger into the EventsService ring buffer, so the in-app "Live system log" shows
 * the same operational narration the services already emit via `this.logger.log(...)` — no new call
 * sites. Still prints to stdout (via ConsoleLogger) for server logs. Framework bootstrap logs are
 * filtered out; the ring is bounded, so high-frequency demo logs (5 concurrent sends) just scroll.
 */
export class RingLogger extends ConsoleLogger {
  constructor(private readonly events: EventsService) {
    super();
  }

  private tee(level: LogLine['level'], message: unknown, params: unknown[]): void {
    const context = params.length && typeof params[params.length - 1] === 'string' ? (params[params.length - 1] as string) : undefined;
    if (context && FRAMEWORK_CONTEXTS.has(context)) return;
    if (typeof message !== 'string') return;
    this.events.emit(context ? `[${context}] ${message}` : message, level);
  }

  log(message: unknown, ...params: unknown[]): void {
    super.log(message as never, ...(params as never[]));
    this.tee('info', message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    super.warn(message as never, ...(params as never[]));
    this.tee('warn', message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    super.error(message as never, ...(params as never[]));
    this.tee('error', message, params);
  }
}
