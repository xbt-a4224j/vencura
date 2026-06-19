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
    const body = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
    const detail = body.detail ?? body.message;
    // 4xx details are meaningful (policy violation, insufficient funds, bad address); surface them.
    // For a 5xx, never leak a bare "Internal server error" — give a friendly, retryable message.
    if (res.status >= 500 && (!detail || /internal server error/i.test(detail))) {
      throw new Error(`Something went wrong on the server (${res.status}). Please try again.`);
    }
    throw new Error(detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface AuthResult {
  accessToken: string;
  user: { id: string; email: string };
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
// Unified on/off-chain activity item (GET /wallets/:id/activity).
export type ActivityItem =
  | {
      kind: 'transaction';
      id: string;
      status: string;
      asset: string;
      amount: string;
      to: string;
      txHash: string | null;
      createdAt: string;
    }
  | { kind: 'signature'; id: string; message: string; signature: string; createdAt: string };

export interface Policy {
  walletId?: string;
  allowlist: string[];
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
  register: (email: string, password: string) =>
    call<AuthResult>('/auth/register', { method: 'POST', body: { email, password } }),
  login: (email: string, password: string) =>
    call<AuthResult>('/auth/login', { method: 'POST', body: { email, password } }),
  createWallet: () => call<Wallet>('/wallets', { method: 'POST', auth: true }),
  listWallets: () => call<Wallet[]>('/wallets', { auth: true }),
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
  // #30: move funds between two of your own wallets (reuses the send path).
  transfer: (walletId: string, input: { toWalletId: string; asset: string; amount: string }) =>
    call<Transaction>(`/wallets/${walletId}/transfers`, { method: 'POST', body: input, auth: true }),
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
  getPolicy: (walletId: string) => call<Policy>(`/wallets/${walletId}/policy`, { auth: true }),
  setPolicy: (walletId: string, policy: Policy) =>
    call<Policy>(`/wallets/${walletId}/policy`, { method: 'PUT', body: policy, auth: true }),
  seedDemo: () => call<SeedResult>('/admin/seed', { method: 'POST', admin: true }),
  resetDemo: () => call<SeedResult>('/admin/reset', { method: 'POST', admin: true }),
};
