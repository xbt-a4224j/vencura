// Vercel Edge Middleware — HTTP Basic Auth gate over the whole web app.
//
// Why basic-auth-in-middleware and not Vercel's built-in Password Protection: that's a
// Pro-plan feature; on Hobby the only native option is Vercel SSO. This gates every route
// with a single shared credential instead.
//
// Creds come from env (BASIC_AUTH_USER / BASIC_AUTH_PASS) — NEVER hardcoded, because the
// repo is public. Set them in Vercel project env (they're mirrored in .env.deploy).
//
// IMPORTANT: `/api/*` is excluded. Those requests carry `Authorization: Bearer <JWT>` (the
// app's own auth) and are rewritten to the Railway API — gating them with Basic would both
// break the bearer header and 401 every API call. The SPA + its assets ARE gated.

export const config = { matcher: '/((?!api/).*)' };

export default function middleware(req: Request): Response | undefined {
  const { pathname } = new URL(req.url);
  if (pathname.startsWith('/api')) return; // defensive: API is bearer-authed, never gated

  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) return; // not configured → no gate (don't lock everyone out by accident)

  const header = req.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    const [u, p] = atob(header.slice(6)).split(':');
    if (u === user && p === pass) return; // authenticated → continue to the app
  }

  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="VenCura"' },
  });
}
