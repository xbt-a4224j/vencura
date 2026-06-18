/**
 * The caller's IP for rate-limiting, read from the leftmost X-Forwarded-For entry
 * (the original client, preserved through Railway's edge and the Vercel /api proxy),
 * falling back to req.ip. We can't rely on Express `trust proxy` here: Railway's edge
 * fleet rotates the immediate-hop IP per request, which would give every request a
 * fresh throttle bucket. NOTE: leftmost XFF is client-spoofable — acceptable for
 * casual abuse control, not a security boundary.
 */
export function clientIp(req: { headers: Record<string, unknown>; ip?: string }): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}
