import { Logger } from '@nestjs/common';

// Logs one line per API call — `METHOD /path → status (ms)` — at the response `finish` event.
// Registered as outermost middleware (app.use) so it runs BEFORE guards: it sees EVERY request,
// including auth rejections (401/403) and unmatched routes (404) that never reach a handler — which
// an interceptor, sitting inside the guard boundary, would miss. Path/method/status only; no bodies.
const logger = new Logger('HTTP');

// Minimal shapes of the express req/res we touch — avoids a direct dependency on express types.
interface Req {
  method: string;
  originalUrl: string;
}
interface Res {
  statusCode: number;
  on(event: 'finish', listener: () => void): void;
}

export function httpLogging(req: Req, res: Res, next: () => void): void {
  const start = Date.now();
  res.on('finish', () => {
    logger.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
}
