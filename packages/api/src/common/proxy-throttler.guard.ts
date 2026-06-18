import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { clientIp } from './client-ip';

/**
 * ThrottlerGuard keyed on the real client IP (see clientIp) instead of Express's
 * `trust proxy`-derived req.ip, which rotates per request behind the Railway/Vercel
 * edges and defeats per-IP limiting.
 */
@Injectable()
export class ProxyThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: { headers: Record<string, unknown>; ip?: string }): Promise<string> {
    return Promise.resolve(clientIp(req));
  }
}
