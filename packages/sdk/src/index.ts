import { NATIVE_ASSET, type Hex } from '@vencura/shared';

export { NATIVE_ASSET, type Hex };

export interface Wallet {
  id: string;
  address: Hex;
}
export interface BalanceLine {
  asset: string;
  symbol: string;
  confirmed: string;
  available: string;
  asOfBlock: number | null;
}
export interface WalletBalance {
  walletId: string;
  balances: BalanceLine[];
}
export interface SentTransaction {
  id: string;
  nonce: number | null;
  txHash: string | null;
  status: string;
}
export interface SendInput {
  to: string;
  asset: string; // 'ETH' or an ERC-20 contract address
  amount: string; // base units (wei / token units) — never a float
}
export type ActivityItem =
  | { kind: 'transaction'; id: string; status: string; asset: string; amount: string; to: string; txHash: string | null; createdAt: string }
  | { kind: 'signature'; id: string; message: string; signature: string; createdAt: string };

export interface AuthResult {
  accessToken: string;
  user: { id: string; email: string };
}

/** Error carrying the server's RFC-7807-ish detail and HTTP status. */
export class VencuraError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'VencuraError';
  }
}

/**
 * Minimal typed client for the VenCura REST API. Hand-written (not OpenAPI-generated)
 * to keep the dependency surface small. Holds the bearer token after login/register.
 *
 *   const v = new VencuraClient('http://localhost:3000');
 *   await v.register('a@b.com', 'password123');
 *   const wallet = await v.createWallet();
 */
export class VencuraClient {
  private token?: string;

  constructor(private readonly baseUrl = process.env.VENCURA_API_URL ?? 'http://localhost:3000') {}

  /** Set/override the bearer token (e.g. to resume a session). */
  setToken(token: string) {
    this.token = token;
  }

  private async call<T>(
    path: string,
    opts: { method?: string; body?: unknown; auth?: boolean; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers };
    if (opts.auth) headers.Authorization = `Bearer ${this.token ?? ''}`;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
      throw new VencuraError(body.detail ?? body.message ?? `HTTP ${res.status}`, res.status);
    }
    return res.json() as Promise<T>;
  }

  async register(email: string, password: string): Promise<AuthResult> {
    const r = await this.call<AuthResult>('/auth/register', { method: 'POST', body: { email, password } });
    this.token = r.accessToken;
    return r;
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const r = await this.call<AuthResult>('/auth/login', { method: 'POST', body: { email, password } });
    this.token = r.accessToken;
    return r;
  }

  createWallet(): Promise<Wallet> {
    return this.call<Wallet>('/wallets', { method: 'POST', body: {}, auth: true });
  }

  listWallets(): Promise<Wallet[]> {
    return this.call<Wallet[]>('/wallets', { auth: true });
  }

  getBalance(walletId: string): Promise<WalletBalance> {
    return this.call<WalletBalance>(`/wallets/${walletId}/balance`, { auth: true });
  }

  signMessage(walletId: string, message: string): Promise<{ signature: string }> {
    return this.call(`/wallets/${walletId}/messages`, { method: 'POST', body: { message }, auth: true });
  }

  /** Send native ETH or an ERC-20. Pass an idempotencyKey to make retries safe (one broadcast). */
  sendTransaction(walletId: string, input: SendInput, idempotencyKey?: string): Promise<SentTransaction> {
    return this.call<SentTransaction>(`/wallets/${walletId}/transactions`, {
      method: 'POST',
      body: input,
      auth: true,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    });
  }

  /** Unified on/off-chain history: sends + signatures, newest first. */
  listActivity(walletId: string): Promise<ActivityItem[]> {
    return this.call<ActivityItem[]>(`/wallets/${walletId}/activity`, { auth: true });
  }
}
