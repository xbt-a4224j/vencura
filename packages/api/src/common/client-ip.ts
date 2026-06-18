/**
 * The caller's IP for rate-limiting. We can't rely on Express `trust proxy`: both
 * Railway's edge and Vercel's rewrite present rotating per-request IPs, giving every
 * request a fresh throttle bucket. Resolution, most-trusted first:
 *   1. x-vercel-forwarded-for — Vercel overwrites x-forwarded-for/x-real-ip with its
 *      own rotating edge IP and stashes the true client here (the browser path).
 *   2. leftmost x-forwarded-for — the original client when hitting Railway directly.
 *   3. req.ip — last resort.
 * NOTE: these headers are client-spoofable — acceptable for casual abuse control,
 * not a security boundary (Vercel/Railway set them at a trusted edge).
 */
export function clientIp(req: { headers: Record<string, unknown>; ip?: string }): string {
  const vercel = req.headers['x-vercel-forwarded-for'];
  if (typeof vercel === 'string' && vercel.trim()) {
    return vercel.split(',')[0].trim();
  }
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}
