/**
 * Shared example bootstrap. Defaults to the LIVE deployment so the scripts run with zero setup;
 * point elsewhere with VENCURA_API_URL (e.g. http://localhost:3000 after `pnpm dev` + `db:seed`).
 *
 * Auth is resilient: log in with the shared demo account (exists on the deployment and a seeded
 * local DB), and only fall back to registering a throwaway account on a fresh instance where
 * registration is still open.
 */
import { ADMIN_EMAIL, BasePath, DEMO_PASSWORD, Vencura, type Wallet } from '../src';

export function client(): Vencura {
  return new Vencura({ basePath: process.env.VENCURA_API_URL ?? BasePath.Production });
}

/** A client that's authenticated and ready to use. */
export async function connect(): Promise<Vencura> {
  const v = client();
  try {
    await v.auth.login({ email: ADMIN_EMAIL, password: DEMO_PASSWORD });
  } catch {
    // Fresh instance with no demo account — register one (registration is open until the first user).
    await v.auth.register({ email: `demo+${Date.now()}@example.com`, password: 'password123' });
  }
  return v;
}

/** The account's funded wallet (existing one, or provision + master-fund on first use). */
export async function aWallet(v: Vencura): Promise<Wallet> {
  const wallets = await v.wallets.list();
  return wallets[0] ?? (await v.wallets.provision());
}
