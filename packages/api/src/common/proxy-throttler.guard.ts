import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { clientIp } from './client-ip';

/**
 * ThrottlerGuard keyed on the real client IP (leftmost X-Forwarded-For) instead of
 * Express's `trust proxy`-derived req.ip, which rotates per request behind Railway's
 * edge and defeats per-IP limiting. See clientIp() for the spoofing caveat.
 */
@Injectable()
export class ProxyThrottlerGuard extends ThrottlerGuard {
  private readonly debug = new Logger(ProxyThrottlerGuard.name);
  protected getTracker(req: { headers: Record<string, unknown>; ip?: string }): Promise<string> {
    const tracker = clientIp(req);
    // TEMP diagnostic: see which header carries a stable client IP through Vercel→Railway.
    this.debug.log(
      `tracker=${tracker} xff=${req.headers['x-forwarded-for']} x-real-ip=${req.headers['x-real-ip']} x-vercel-fwd=${req.headers['x-vercel-forwarded-for']}`,
    );
    return Promise.resolve(tracker);
  }
}
