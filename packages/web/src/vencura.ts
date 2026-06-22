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

/** The admin key gates /admin/*. Operator-entered, kept in localStorage — never baked into the
 *  bundle (a static SPA can't hold a secret). */
export const adminKeyStore = {
  get: () => localStorage.getItem(ADMIN_KEY) ?? '',
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
