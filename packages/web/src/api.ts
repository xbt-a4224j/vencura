const TOKEN_KEY = 'vencura.token';
const ADMIN_KEY = 'vencura.adminKey';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// The admin key gates /admin/*. It's operator-entered and kept in localStorage —
// never baked into the bundle (a static SPA can't hold a secret).
export const adminKeyStore = {
  get: () => localStorage.getItem(ADMIN_KEY) ?? '',
  set: (k: string) => localStorage.setItem(ADMIN_KEY, k),
};

// Shared demo password — every account uses it, so the User view signs in with one click (it's
// prepopulated, never typed). The web is a static SPA behind Vercel Auth, so this is a known demo
// credential, not a secret. Mirrors DEMO_PASSWORD in packages/shared (used by the API seed) —
// duplicated here to avoid pulling a workspace build dependency into the SPA for one constant.
export const DEMO_PASSWORD = 'demo-password';

// The seeded operator account — an admin, NOT a regular user. The User view never treats this
// session as "the user". Mirrors ADMIN_EMAIL in packages/shared (kept in sync, duplicated to avoid
// a workspace build dependency in the SPA, same as DEMO_PASSWORD above).
export const ADMIN_EMAIL = 'admin@vencura.local';

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; admin?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.auth) headers.Authorization = `Bearer ${tokenStore.get() ?? ''}`;
  if (options.admin) headers['x-admin-key'] = adminKeyStore.get();
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    // The API's global filter emits RFC-7807 `{ detail }`; fall back to `message` / status.
    const body = (await res.json().catch(() => ({}))) as {
      detail?: string;
      message?: string;
      traceId?: string;
    };
    const detail = body.detail ?? body.message;
    const trace = body.traceId ? ` · trace ${body.traceId}` : '';
    // 4xx details are meaningful (policy violation, insufficient funds, bad address); surface them.
    // For a 5xx, never leak a bare "Internal server error" — give a friendly, retryable message + trace id.
    if (res.status >= 500 && (!detail || /internal server error/i.test(detail))) {
      throw new Error(`Something went wrong on the server (${res.status})${trace}. Please try again.`);
    }
    throw new Error(detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface AuthResult {
  accessToken: string;
  user: { id: string; email: string };
}
export interface Account {
  id: string;
  email: string;
}
export interface Wallet {
  id: string;
  address: string;
  createdAt?: string;
}
export interface BalanceLine {
  asset: string;
  symbol: string;
  confirmed: string;
  available: string;
  asOfBlock: number | null;
}
export interface BalanceView {
  walletId: string;
  balances: BalanceLine[];
}
export interface Transaction {
  id: string;
  asset: string;
  amount: string;
  toAddress: string;
  status: 'pending' | 'confirmed' | 'failed';
  txHash: string | null;
  nonce: number | null;
  createdAt: string;
}
// Unified on/off-chain + audit activity item (GET /wallets/:id/activity · GET /activity).
export type ActivityItem =
  | {
      kind: 'transaction';
      id: string;
      status: string;
      asset: string;
      amount: string;
      to: string;
      txHash: string | null;
      walletId?: string;
      createdAt: string;
    }
  | { kind: 'signature'; id: string; message: string; signature: string; walletId?: string; createdAt: string }
  | {
      kind: 'audit';
      id: string;
      type: string;
      detail: unknown;
      walletId: string | null;
      createdAt: string;
    }
  | {
      kind: 'received';
      id: string;
      asset: string;
      amount: string;
      from: string;
      txHash: string;
      walletId?: string;
      createdAt: string;
    };

// One line of the live "system log" ring buffer (GET /events?after=seq).
export interface LogLine {
  seq: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export interface Policy {
  walletId?: string;
  perTxLimit: string | null;
  dailyLimit: string | null;
}
export interface SendInput {
  to: string;
  asset: string;
  amount: string; // base units (wei / token units)
}
export interface SeedResult {
  email: string;
  password: string;
  wallets: { id: string; address: string; funded: boolean }[];
}

export const api = {
  // Account picker (User view) + real credentialed auth. Sign-in uses the shared demo password
  // (DEMO_PASSWORD), prepopulated client-side, so there is no typed login form anywhere.
  listAccounts: () => call<Account[]>('/auth/accounts'),
  // The single self-registered user (or null) — drives User-view register-vs-login.
  singleUser: () => call<Account | null>('/auth/user'),
  login: (email: string, password: string) =>
    call<AuthResult>('/auth/login', { method: 'POST', body: { email, password } }),
  register: (email: string, password: string) =>
    call<AuthResult>('/auth/register', { method: 'POST', body: { email, password } }),
  // Public chain head for the status-bar heartbeat (block height + gas), no auth.
  chainHead: () => call<{ network: string; blockNumber: number; gasGwei: number }>('/chain/head'),
  // One wallet per account: returns the user's wallet, creating + master-funding it on first call.
  provisionWallet: () => call<Wallet>('/wallets/provision', { method: 'POST', auth: true }),
  listWallets: () => call<Wallet[]>('/wallets', { auth: true }),
  // Admin-only: every platform wallet (address + owner email) for the token-flow holder picker.
  listHolders: () => call<{ address: string; email: string }[]>('/wallets/holders', { auth: true }),
  getBalance: (walletId: string) => call<BalanceView>(`/wallets/${walletId}/balance`, { auth: true }),
  signMessage: (walletId: string, message: string) =>
    call<{ signature: string }>(`/wallets/${walletId}/messages`, {
      method: 'POST',
      body: { message },
      auth: true,
    }),
  send: (walletId: string, input: SendInput) =>
    call<Transaction>(`/wallets/${walletId}/transactions`, {
      method: 'POST',
      body: input,
      auth: true,
    }),
  // #32: generic contract read (eth_call) + write (encode → send path).
  contractRead: (input: { address: string; abi: unknown; functionName: string; args?: unknown[] }) =>
    call<{ result: unknown }>('/contract/read', { method: 'POST', body: input, auth: true }),
  contractWrite: (
    walletId: string,
    input: { address: string; abi: unknown; functionName: string; args?: unknown[]; value?: string },
  ) => call<Transaction>(`/wallets/${walletId}/contract/write`, { method: 'POST', body: input, auth: true }),
  listTransactions: (walletId: string) =>
    call<Transaction[]>(`/wallets/${walletId}/transactions`, { auth: true }),
  listActivity: (walletId: string) =>
    call<ActivityItem[]>(`/wallets/${walletId}/activity`, { auth: true }),
  // Cross-wallet unified activity (audit trail) for the signed-in user.
  listAllActivity: () => call<ActivityItem[]>('/activity', { auth: true }),
  // Live system-log ring buffer; poll with the last-seen seq as a cursor.
  events: (after = 0) => call<{ lines: LogLine[]; seq: number }>(`/events?after=${after}`, { auth: true }),
  // Demo ERC-20 (approve/transferFrom demo): deploy from a wallet, or read the current token.
  deployToken: (walletId: string) =>
    call<{ address: string; owner: string; txHash: string }>(`/wallets/${walletId}/deploy-token`, {
      method: 'POST',
      auth: true,
    }),
  getToken: () => call<{ address: string; owner: string } | null>('/token', { auth: true }),
  getPolicy: (walletId: string) => call<Policy>(`/wallets/${walletId}/policy`, { auth: true }),
  setPolicy: (walletId: string, policy: Policy) =>
    call<Policy>(`/wallets/${walletId}/policy`, { method: 'PUT', body: policy, auth: true }),
  // Admin-gated: creates a demo account (shared password + isDemo) so it appears in the picker.
  createDemoAccount: (email: string) =>
    call<Account>('/admin/accounts', { method: 'POST', body: { email }, admin: true }),
  seedDemo: () => call<SeedResult>('/admin/seed', { method: 'POST', admin: true }),
  resetDemo: () => call<SeedResult>('/admin/reset', { method: 'POST', admin: true }),
};
