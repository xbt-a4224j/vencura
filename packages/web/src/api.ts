const TOKEN_KEY = 'vencura.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.auth) headers.Authorization = `Bearer ${tokenStore.get() ?? ''}`;
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    // The API's global filter emits RFC-7807 `{ detail }`; fall back to `message` / status.
    const body = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
    throw new Error(body.detail ?? body.message ?? `HTTP ${res.status}`);
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
  listTransactions: (walletId: string) =>
    call<Transaction[]>(`/wallets/${walletId}/transactions`, { auth: true }),
  getPolicy: (walletId: string) => call<Policy>(`/wallets/${walletId}/policy`, { auth: true }),
  setPolicy: (walletId: string, policy: Policy) =>
    call<Policy>(`/wallets/${walletId}/policy`, { method: 'PUT', body: policy, auth: true }),
  seedDemo: () => call<SeedResult>('/admin/seed', { method: 'POST' }),
};
