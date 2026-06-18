import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/**
 * Gates /admin/* behind a shared secret sent as the `x-admin-key` header,
 * compared against ADMIN_API_KEY. Fails closed: no env, no match → 403.
 * A single key (not RBAC) — the data model has no roles, and ops endpoints
 * don't warrant one.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_API_KEY;
    const provided = context.switchToHttp().getRequest().headers['x-admin-key'];
    if (!expected || typeof provided !== 'string') {
      throw new ForbiddenException('admin key required');
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('admin key required');
    }
    return true;
  }
}
