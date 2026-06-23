import {
  type Account,
  type ActivityItem,
  type BalanceLine,
  type LogLine,
  Vencura,
  type Wallet,
  type WalletOverview,
} from '@vencura/sdk';

const TOKEN_KEY = 'vencura.token';
const ADMIN_KEY = 'vencura.adminKey';

/** JWT persistence — localStorage so a session survives reloads. Shared with the SDK client below. */
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** The admin key gates /admin/*. Operator-entered, kept in localStorage. The deployed demo also
 *  seeds it from `VITE_ADMIN_KEY` so a reviewer who's already past the site password gate can drive
 *  the admin console without a manual paste — acceptable because the whole app is gated and /admin/*
 *  is demo-only (reset/seed) on Sepolia testnet. Unset in local dev → operator pastes it as before. */
export const adminKeyStore = {
  get: () => localStorage.getItem(ADMIN_KEY) || import.meta.env.VITE_ADMIN_KEY || '',
  set: (k: string) => localStorage.setItem(ADMIN_KEY, k),
};


/**
 * The single SDK client the whole app drives. Same-origin: the SPA is served alongside the API
 * behind a `/api` rewrite. Reuses the localStorage token store (session survives reloads) and reads
 * the operator admin key at call time. The admin UI dogfoods the same `@vencura/sdk` a customer
 * would use — every screen goes through it.
 */
export const v = new Vencura({ basePath: '/api', tokenStore, adminKey: () => adminKeyStore.get() });

// Re-export the response models the components type against (single source: @vencura/shared).
export type { Account, ActivityItem, BalanceLine, LogLine, Wallet, WalletOverview };
