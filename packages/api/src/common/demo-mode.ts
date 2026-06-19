/** The cross-account picker (GET /auth/accounts) enumerates the demo accounts so the Admin view is
 *  one-click. Gated on this flag — default ON; set DEMO_MODE=false in a real deployment, where that
 *  endpoint must NOT enumerate accounts. The posture an enterprise reviewer expects in code. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE !== 'false';
}
