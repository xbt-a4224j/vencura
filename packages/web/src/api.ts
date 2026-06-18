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
    const detail = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(detail.message ?? `HTTP ${res.status}`);
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
};
