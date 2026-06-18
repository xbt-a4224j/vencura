import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { clientIp } from './client-ip';

/**
 * ThrottlerGuard keyed on the real client IP (leftmost X-Forwarded-For) instead of
 * Express's `trust proxy`-derived req.ip, which rotates per request behind Railway's
 * edge and defeats per-IP limiting. See clientIp() for the spoofing caveat.
 */
@Injectable()
export class ProxyThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: { headers: Record<string, unknown>; ip?: string }): Promise<string> {
    return Promise.resolve(clientIp(req));
  }
}
