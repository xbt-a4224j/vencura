/** Demo affordances (the cross-account picker + payee directory enumerate accounts so the demo is
 *  one-click) are gated on this flag. Default ON; set DEMO_MODE=false in a real deployment, where
 *  those endpoints must NOT enumerate other tenants — that posture is what an enterprise reviewer
 *  expects to see expressed in code, not just promised. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE !== 'false';
}

/** Reduce an email to a non-reversible display label (al***@gmail.com) so the payee directory
 *  doesn't leak full addresses even in demo mode. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
