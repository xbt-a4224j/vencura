import { erc20Abi } from 'viem';
import {
  type Account,
  type ActivityItem,
  type AuthResult,
  type BalanceView,
  type ChainHead,
  type ContractReadResult,
  type DeployTokenResult,
  type Holder,
  type LogLine,
  type PolicyView,
  type SeedResult,
  type TokenInfo,
  type Transaction,
  type Wallet,
} from '@vencura/shared';

export * from '@vencura/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Known API endpoints (mirrors Fireblocks' BasePath.Sandbox / Production). */
export enum BasePath {
  Local = 'http://localhost:3000',
  Production = 'https://vencura-alpha.vercel.app/api',
}

/** Where the SDK persists the JWT. Default is in-memory; the web injects a localStorage-backed one
 *  so a session survives reloads. Node scripts use the default. */
export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

const memoryTokenStore = (): TokenStore => {
  let token: string | null = null;
  return { get: () => token, set: (t) => (token = t), clear: () => (token = null) };
};

export interface VencuraOptions {
  basePath?: BasePath | string;
  /** JWT persistence (default in-memory). */
  tokenStore?: TokenStore;
  /** x-admin-key for /admin/* — a value or a getter (the web reads it from localStorage at call time). */
  adminKey?: string | (() => string | null);
  /** Override fetch (Node < 18, tests). */
  fetch?: typeof fetch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors — VencuraError carries the server's code/traceId; typed subclasses for common cases.
// ─────────────────────────────────────────────────────────────────────────────

export class VencuraError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class AuthError extends VencuraError {}
export class InsufficientFundsError extends VencuraError {}
export class InsufficientAllowanceError extends VencuraError {}
export class InsufficientTokenBalanceError extends VencuraError {}
export class NonceTooLowError extends VencuraError {}
export class ExecutionRevertedError extends VencuraError {}
export class RpcUnavailableError extends VencuraError {}

const ERROR_BY_CODE: Record<string, new (m: string, s: number, c?: string, t?: string) => VencuraError> = {
  INSUFFICIENT_FUNDS: InsufficientFundsError,
  INSUFFICIENT_ALLOWANCE: InsufficientAllowanceError,
  INSUFFICIENT_TOKEN_BALANCE: InsufficientTokenBalanceError,
  NONCE_TOO_LOW: NonceTooLowError,
  EXECUTION_REVERTED: ExecutionRevertedError,
  RPC_UNAVAILABLE: RpcUnavailableError,
};

function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport — one HTTP layer shared by every resource API.
// ─────────────────────────────────────────────────────────────────────────────

interface RequestOpts {
  method?: string;
  body?: unknown;
  auth?: boolean;
  admin?: boolean;
  idempotencyKey?: string;
  query?: Record<string, string | number>;
}

class Http {
  readonly baseUrl: string;
  readonly tokenStore: TokenStore;
  private readonly adminKey?: string | (() => string | null);
  private readonly fetchFn: typeof fetch;

  constructor(opts: VencuraOptions) {
    const envUrl = typeof process !== 'undefined' ? process?.env?.VENCURA_API_URL : undefined;
    this.baseUrl = (opts.basePath ?? envUrl ?? BasePath.Local).toString().replace(/\/$/, '');
    this.tokenStore = opts.tokenStore ?? memoryTokenStore();
    this.adminKey = opts.adminKey;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
  }

  private resolveAdminKey(): string {
    return (typeof this.adminKey === 'function' ? this.adminKey() : this.adminKey) ?? '';
  }

  async request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.auth) headers.Authorization = `Bearer ${this.tokenStore.get() ?? ''}`;
    if (opts.admin) headers['x-admin-key'] = this.resolveAdminKey();
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    const qs = opts.query
      ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)]))}`
      : '';
    const res = await this.fetchFn(`${this.baseUrl}${path}${qs}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (!res.ok) throw await this.toError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Build a typed error from the API's RFC-7807 body ({ detail, code, traceId }). 5xx → a friendly,
   *  retryable message (never leak a bare "Internal server error"). */
  private async toError(res: Response): Promise<VencuraError> {
    const body = (await res.json().catch(() => ({}))) as {
      detail?: string;
      message?: string;
      code?: string;
      traceId?: string;
    };
    const code = body.code;
    const trace = body.traceId ? ` · trace ${body.traceId}` : '';
    let detail = body.detail ?? body.message;
    if (res.status >= 500 && (!detail || /internal server error/i.test(detail))) {
      detail = `Something went wrong on the server (${res.status})${trace}. Please try again.`;
    }
    const message = detail ?? `HTTP ${res.status}`;
    const Ctor = res.status === 401 ? AuthError : (code && ERROR_BY_CODE[code]) || VencuraError;
    return new Ctor(message, res.status, code, body.traceId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource APIs
// ─────────────────────────────────────────────────────────────────────────────

class AuthApi {
  constructor(private readonly http: Http) {}
  /** Register the single self-service account; stores the JWT. */
  async register(p: { email: string; password: string }): Promise<AuthResult> {
    const r = await this.http.request<AuthResult>('/auth/register', { method: 'POST', body: p });
    this.http.tokenStore.set(r.accessToken);
    return r;
  }
  /** Log in; stores the JWT. */
  async login(p: { email: string; password: string }): Promise<AuthResult> {
    const r = await this.http.request<AuthResult>('/auth/login', { method: 'POST', body: p });
    this.http.tokenStore.set(r.accessToken);
    return r;
  }
  /** Who the stored token belongs to (restores a session). Throws AuthError if missing/expired. */
  me(): Promise<Account> {
    return this.http.request<Account>('/auth/me', { auth: true });
  }
  /** Demo account picker (id + email only). */
  accounts(): Promise<Account[]> {
    return this.http.request<Account[]>('/auth/accounts');
  }
  /** The single self-registered user, or null. */
  singleUser(): Promise<Account | null> {
    return this.http.request<Account | null>('/auth/user');
  }
  logout(): void {
    this.http.tokenStore.clear();
  }
}

class WalletsApi {
  constructor(private readonly http: Http) {}
  /** Create a wallet (encrypted key generated + stored server-side). */
  create(): Promise<Wallet> {
    return this.http.request<Wallet>('/wallets', { method: 'POST', body: {}, auth: true });
  }
  /** One wallet per account: returns it, creating + master-funding on first call. */
  provision(): Promise<Wallet> {
    return this.http.request<Wallet>('/wallets/provision', { method: 'POST', auth: true });
  }
  list(): Promise<Wallet[]> {
    return this.http.request<Wallet[]>('/wallets', { auth: true });
  }
  /** Admin-only: every platform wallet (address + owner email) for the holder picker. */
  holders(): Promise<Holder[]> {
    return this.http.request<Holder[]>('/wallets/holders', { auth: true });
  }
  getBalance(p: { walletId: string }): Promise<BalanceView> {
    return this.http.request<BalanceView>(`/wallets/${p.walletId}/balance`, { auth: true });
  }
  /** Off-chain proof of ownership (EIP-191). */
  signMessage(p: { walletId: string; message: string }): Promise<{ signature: string }> {
    return this.http.request(`/wallets/${p.walletId}/messages`, { method: 'POST', body: { message: p.message }, auth: true });
  }
  getPolicy(p: { walletId: string }): Promise<PolicyView> {
    return this.http.request<PolicyView>(`/wallets/${p.walletId}/policy`, { auth: true });
  }
  setPolicy(p: { walletId: string; perTxLimit: string | null; dailyLimit: string | null }): Promise<PolicyView> {
    return this.http.request<PolicyView>(`/wallets/${p.walletId}/policy`, {
      method: 'PUT',
      body: { perTxLimit: p.perTxLimit, dailyLimit: p.dailyLimit },
      auth: true,
    });
  }
}

export interface ConfirmOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

class TransactionsApi {
  constructor(private readonly http: Http) {}
  /** Send native ETH or an ERC-20 (asset = 'ETH' or token address). An idempotency key is generated
   *  if you don't pass one, so a retried request can't double-broadcast (exactly-once). */
  send(p: { walletId: string; to: string; asset: string; amount: string; idempotencyKey?: string }): Promise<Transaction> {
    return this.http.request<Transaction>(`/wallets/${p.walletId}/transactions`, {
      method: 'POST',
      body: { to: p.to, asset: p.asset, amount: p.amount },
      auth: true,
      idempotencyKey: p.idempotencyKey ?? newIdempotencyKey(),
    });
  }
  list(p: { walletId: string }): Promise<Transaction[]> {
    return this.http.request<Transaction[]>(`/wallets/${p.walletId}/transactions`, { auth: true });
  }
  /** Poll until the tx leaves `pending` (confirmed/failed) or the timeout elapses. */
  async waitForConfirmation(p: { walletId: string; txHash: string } & ConfirmOptions): Promise<Transaction> {
    const interval = p.intervalMs ?? 4000;
    const deadline = Date.now() + (p.timeoutMs ?? 120_000);
    for (;;) {
      const txs = await this.list({ walletId: p.walletId });
      const tx = txs.find((t) => t.txHash?.toLowerCase() === p.txHash.toLowerCase());
      if (tx && tx.status !== 'pending') return tx;
      if (Date.now() >= deadline) {
        throw new VencuraError(`timed out waiting for ${p.txHash} to confirm`, 0, 'CONFIRMATION_TIMEOUT');
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  /** send → wait. One await for "broadcast and finalized". */
  async sendAndConfirm(
    p: { walletId: string; to: string; asset: string; amount: string; idempotencyKey?: string } & ConfirmOptions,
  ): Promise<Transaction> {
    const sent = await this.send(p);
    if (!sent.txHash) return sent;
    return this.waitForConfirmation({ walletId: p.walletId, txHash: sent.txHash, intervalMs: p.intervalMs, timeoutMs: p.timeoutMs });
  }
  /** Generic contract read (eth_call + decode). */
  contractRead(p: { address: string; abi: unknown; functionName: string; args?: unknown[] }): Promise<ContractReadResult> {
    return this.http.request<ContractReadResult>('/contract/read', { method: 'POST', body: p, auth: true });
  }
  /** Generic contract write (encode → the locked send path). */
  contractWrite(p: {
    walletId: string;
    address: string;
    abi: unknown;
    functionName: string;
    args?: unknown[];
    value?: string;
    idempotencyKey?: string;
  }): Promise<Transaction> {
    const { walletId, idempotencyKey, ...body } = p;
    return this.http.request<Transaction>(`/wallets/${walletId}/contract/write`, {
      method: 'POST',
      body,
      auth: true,
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
    });
  }
}

class TokensApi {
  constructor(
    private readonly http: Http,
    private readonly tx: TransactionsApi,
  ) {}
  /** Deploy the demo ERC-20 from a funded wallet (mints the supply to it). */
  deploy(p: { walletId: string }): Promise<DeployTokenResult> {
    return this.http.request<DeployTokenResult>(`/wallets/${p.walletId}/deploy-token`, { method: 'POST', auth: true });
  }
  /** The current demo token (address + owner), or null. */
  get(): Promise<TokenInfo | null> {
    return this.http.request<TokenInfo | null>('/token', { auth: true });
  }
  // Typed conveniences over the generic contract endpoints — amounts are base-unit strings.
  transfer(p: { walletId: string; token: string; to: string; amount: string }): Promise<Transaction> {
    return this.tx.contractWrite({ walletId: p.walletId, address: p.token, abi: erc20Abi, functionName: 'transfer', args: [p.to, p.amount] });
  }
  approve(p: { walletId: string; token: string; spender: string; amount: string }): Promise<Transaction> {
    return this.tx.contractWrite({ walletId: p.walletId, address: p.token, abi: erc20Abi, functionName: 'approve', args: [p.spender, p.amount] });
  }
  transferFrom(p: { walletId: string; token: string; from: string; to: string; amount: string }): Promise<Transaction> {
    return this.tx.contractWrite({ walletId: p.walletId, address: p.token, abi: erc20Abi, functionName: 'transferFrom', args: [p.from, p.to, p.amount] });
  }
  async allowance(p: { token: string; owner: string; spender: string }): Promise<bigint> {
    const r = await this.tx.contractRead({ address: p.token, abi: erc20Abi, functionName: 'allowance', args: [p.owner, p.spender] });
    return BigInt(String(r.result));
  }
  async balanceOf(p: { token: string; owner: string }): Promise<bigint> {
    const r = await this.tx.contractRead({ address: p.token, abi: erc20Abi, functionName: 'balanceOf', args: [p.owner] });
    return BigInt(String(r.result));
  }
}

class ActivityApi {
  constructor(private readonly http: Http) {}
  /** Per-wallet unified activity (sends, signatures, received, governance), newest-first. */
  forWallet(p: { walletId: string }): Promise<ActivityItem[]> {
    return this.http.request<ActivityItem[]>(`/wallets/${p.walletId}/activity`, { auth: true });
  }
  /** Cross-wallet activity for the signed-in user (admin sees system-wide). */
  all(): Promise<ActivityItem[]> {
    return this.http.request<ActivityItem[]>('/activity', { auth: true });
  }
  /** Live system-log ring buffer; poll with the last-seen seq as the cursor. */
  events(p: { after?: number } = {}): Promise<{ lines: LogLine[]; seq: number }> {
    return this.http.request('/events', { auth: true, query: { after: p.after ?? 0 } });
  }
}

class ChainApi {
  constructor(private readonly http: Http) {}
  /** Network heartbeat: block height + gas (public, no auth). */
  head(): Promise<ChainHead> {
    return this.http.request<ChainHead>('/chain/head');
  }
}

class AdminApi {
  constructor(private readonly http: Http) {}
  /** Create a demo account (shared password + isDemo) — admin-key gated. */
  createAccount(p: { email: string }): Promise<Account> {
    return this.http.request<Account>('/admin/accounts', { method: 'POST', body: p, admin: true });
  }
  seed(): Promise<SeedResult> {
    return this.http.request<SeedResult>('/admin/seed', { method: 'POST', admin: true });
  }
  reset(): Promise<SeedResult> {
    return this.http.request<SeedResult>('/admin/reset', { method: 'POST', admin: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client — resource-grouped, like the Fireblocks SDK (v.wallets.x(), v.transactions.x()).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The VenCura SDK client.
 *
 *   const v = new Vencura({ basePath: BasePath.Production });
 *   await v.auth.login({ email, password });
 *   const w = await v.wallets.create();
 *   const tx = await v.transactions.sendAndConfirm({ walletId: w.id, to: 'vitalik.eth', asset: 'ETH', amount: '10000000000000' });
 */
export class Vencura {
  private readonly http: Http;
  readonly auth: AuthApi;
  readonly wallets: WalletsApi;
  readonly transactions: TransactionsApi;
  readonly tokens: TokensApi;
  readonly activity: ActivityApi;
  readonly chain: ChainApi;
  readonly admin: AdminApi;

  constructor(opts: VencuraOptions | BasePath | string = {}) {
    this.http = new Http(typeof opts === 'object' ? opts : { basePath: opts });
    this.auth = new AuthApi(this.http);
    this.wallets = new WalletsApi(this.http);
    this.transactions = new TransactionsApi(this.http);
    this.tokens = new TokensApi(this.http, this.transactions);
    this.activity = new ActivityApi(this.http);
    this.chain = new ChainApi(this.http);
    this.admin = new AdminApi(this.http);
  }

  /** Set/override the bearer token (e.g. to resume a session without logging in again). */
  setToken(token: string): void {
    this.http.tokenStore.set(token);
  }
}
