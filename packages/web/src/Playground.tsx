import Editor, { type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { transform } from 'sucrase';
import { parseEther, recoverMessageAddress } from 'viem';
import { NATIVE_ASSET } from '@vencura/sdk';
import { v } from './vencura';

type Example = {
  file: string;
  mutates?: boolean; // broadcasts a real Sepolia tx
  req: boolean; // a take-home requirement (vs beyond-brief)
  maps: string; // the requirement / capability it demonstrates
  note: string; // one-line, reviewer-facing
  flow: string[]; // tiny flow diagram (steps)
  code: string;
};

// The six example scripts, adapted to run in the in-browser interpreter: `v` is the live SDK client,
// `log(...)` streams to the output, the last `return` is shown. parseEther / recoverMessageAddress /
// NATIVE_ASSET are in scope so the bodies read like the repo's examples.
const EXAMPLES: Example[] = [
  {
    file: '01-create-wallet.ts',
    req: true,
    maps: 'A user can create at least one account/wallet',
    note: 'Key is generated + AES-256-GCM encrypted server-side; you only ever see the address.',
    flow: ['account', 'encrypt key', 'address'],
    code: `// Provision the account's wallet (one per account). The platform generates + encrypts the
// private key server-side and master-funds it; you get an address back.
const wallet = await v.wallets.provision();
log('wallet id', wallet.id);
return wallet.address;
`,
  },
  {
    file: '02-get-balance.ts',
    req: true,
    maps: 'getBalance() → balance',
    note: 'Chain is the source of truth; the DB is a cache. available = confirmed − pending − gas reserve.',
    flow: ['chain', 'cache', 'available'],
    code: `// Confirmed + available balance. available = confirmed − pending − a small gas reserve.
const wallet = await v.wallets.provision();
const { balances } = await v.wallets.getBalance({ walletId: wallet.id });
return balances;
`,
  },
  {
    file: '03-sign-message.ts',
    req: true,
    maps: 'signMessage(msg) → signedMessage',
    note: 'EIP-191 off-chain signature; recover the signer to prove it’s this wallet. No gas, no tx.',
    flow: ['message', 'sign (key)', 'recover ✓'],
    code: `// Off-chain proof of ownership (EIP-191) — no gas. Sign, then recover the signer locally and
// confirm it's this wallet. The private key never leaves the server.
const wallet = await v.wallets.provision();
const message = \`I control \${wallet.address} — signed off-chain (no gas).\`;
const { signature } = await v.wallets.signMessage({ walletId: wallet.id, message });
const recovered = await recoverMessageAddress({ message, signature });
log('recovered', recovered);
return { signature, matches: recovered.toLowerCase() === wallet.address.toLowerCase() };
`,
  },
  {
    file: '04-send-transaction.ts',
    mutates: true,
    req: true,
    maps: 'sendTransaction(to, amount) → transactionHash',
    note: 'The core send — with an auto idempotency key (exactly-once on retry) and on-chain confirmation.',
    flow: ['sign', 'broadcast', 'confirm'],
    code: `// Broadcasts a REAL Sepolia tx (1 wei to self). sendAndConfirm auto-generates an idempotency
// key (a retry can't double-broadcast) and polls until the tx leaves 'pending' (~15–30s on Sepolia).
const wallet = await v.wallets.provision();
log('broadcasting 1 wei → self, waiting for confirmation (~15–30s on Sepolia)…');
return await v.transactions.sendAndConfirm({
  walletId: wallet.id,
  to: wallet.address,
  asset: NATIVE_ASSET,
  amount: '1',
});
`,
  },
  {
    file: '05-concurrency.ts',
    mutates: true,
    req: false,
    maps: 'Beyond the brief — correctness under concurrency',
    note: 'Racing sends would collide on the nonce; the per-wallet Postgres advisory lock serializes them.',
    flow: ['5 sends', 'nonce lock', 'n … n+4'],
    code: `// Fire N sends at ONE wallet simultaneously. The per-wallet Postgres advisory lock serializes the
// critical section, so every send gets a unique, consecutive nonce — no collisions, no gaps.
const wallet = await v.wallets.provision();
const N = 5;
log('firing', N, 'concurrent sends…');
const results = await Promise.all(
  Array.from({ length: N }, () =>
    v.transactions
      .send({ walletId: wallet.id, to: wallet.address, asset: NATIVE_ASSET, amount: '1' })
      .then((tx) => tx.nonce)
      .catch((e) => 'error: ' + e.message),
  ),
);
const nonces = (results.filter((n) => typeof n === 'number') as number[]).sort((a, b) => a - b);
return {
  nonces,
  unique: new Set(nonces).size === nonces.length,
  consecutive: nonces.every((n, i) => i === 0 || n === nonces[i - 1] + 1),
};
`,
  },
  {
    file: '06-token-flow.ts',
    mutates: true,
    req: true,
    maps: 'Support the native asset AND tokens (ERC-20)',
    note: 'approve → allowance → transferFrom via typed token helpers — the on-chain allowance is the gate.',
    flow: ['approve', 'allowance', 'transferFrom'],
    code: `// ERC-20 approve → allowance → transferFrom via the typed token helpers (single-wallet/self demo).
const owner = await v.wallets.provision();
const token = await v.tokens.get(); // fixed pre-deployed VCD token
log('token', token.address);
const appr = await v.tokens.approve({ walletId: owner.id, token: token.address, spender: owner.address, amount: parseEther('50').toString() });
log('approve sent, waiting…');
await v.transactions.waitForConfirmation({ walletId: owner.id, txHash: appr.txHash! });
log('allowance', await v.tokens.allowance({ token: token.address, owner: owner.address, spender: owner.address }));
const pull = await v.tokens.transferFrom({ walletId: owner.id, token: token.address, from: owner.address, to: owner.address, amount: parseEther('50').toString() });
await v.transactions.waitForConfirmation({ walletId: owner.id, txHash: pull.txHash! });
return await v.tokens.balanceOf({ token: token.address, owner: owner.address });
`,
  },
];

// Curated ambient types so the editor gives real autocomplete on `v.` + the injected helpers.
const DECLS = `
type Hex = string;
interface Wallet { id: string; address: string; createdAt?: string }
interface BalanceLine { asset: string; symbol: string; confirmed: string; available: string; asOfBlock: number | null }
interface BalanceView { walletId: string; balances: BalanceLine[] }
interface Transaction { id: string; asset: string; amount: string; toAddress: string; status: 'pending' | 'confirmed' | 'failed'; txHash: string | null; nonce: number | null; createdAt: string }
interface TokenInfo { address: string; owner: string }
interface Account { id: string; email: string }
interface ConfirmOpts { intervalMs?: number; timeoutMs?: number }
declare const v: {
  auth: {
    login(p: { email: string; password: string }): Promise<{ accessToken: string; user: Account }>;
    register(p: { email: string; password: string }): Promise<{ accessToken: string; user: Account }>;
    me(): Promise<Account>;
    adminSession(): Promise<{ accessToken: string; user: Account }>;
    singleUser(): Promise<Account | null>;
  };
  wallets: {
    provision(): Promise<Wallet>;
    list(): Promise<Wallet[]>;
    holders(): Promise<{ address: string; email: string }[]>;
    getBalance(p: { walletId: string }): Promise<BalanceView>;
    signMessage(p: { walletId: string; message: string }): Promise<{ signature: string }>;
  };
  transactions: {
    send(p: { walletId: string; to: string; asset: string; amount: string; idempotencyKey?: string }): Promise<Transaction>;
    sendAndConfirm(p: { walletId: string; to: string; asset: string; amount: string } & ConfirmOpts): Promise<Transaction>;
    waitForConfirmation(p: { walletId: string; txHash: string } & ConfirmOpts): Promise<Transaction>;
    list(p: { walletId: string }): Promise<Transaction[]>;
    contractRead(p: { address: string; abi: unknown; functionName: string; args?: unknown[] }): Promise<{ result: unknown }>;
    contractWrite(p: { walletId: string; address: string; abi: unknown; functionName: string; args?: unknown[]; value?: string }): Promise<Transaction>;
  };
  tokens: {
    get(): Promise<TokenInfo>;
    transfer(p: { walletId: string; token: string; to: string; amount: string }): Promise<Transaction>;
    approve(p: { walletId: string; token: string; spender: string; amount: string }): Promise<Transaction>;
    allowance(p: { token: string; owner: string; spender: string }): Promise<bigint>;
    balanceOf(p: { token: string; owner: string }): Promise<bigint>;
    totalSupply(p: { token: string }): Promise<bigint>;
    transferFrom(p: { walletId: string; token: string; from: string; to: string; amount: string }): Promise<Transaction>;
  };
  activity: {
    forWallet(p: { walletId: string }): Promise<any[]>;
    all(): Promise<any[]>;
    events(p?: { after?: number }): Promise<{ lines: any[]; seq: number }>;
  };
  chain: { head(): Promise<{ network: string; blockNumber: number; gasGwei: number }> };
  admin: {
    reset(): Promise<any>;
  };
};
declare function log(...args: unknown[]): void;
declare const NATIVE_ASSET: 'ETH';
declare function parseEther(ether: string): bigint;
declare function recoverMessageAddress(args: { message: string; signature: string }): Promise<string>;
`;

const show = (x: unknown): string =>
  JSON.stringify(x, (_k, val) => (typeof val === 'bigint' ? `${val}n` : val), 2);

export function Playground({ onExit }: { onExit: () => void }) {
  const [active, setActive] = useState(0);
  const [code, setCode] = useState(EXAMPLES[0].code);
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [authed, setAuthed] = useState(false);
  const configured = useRef(false);
  const ex = EXAMPLES[active];

  // Auto-mint the admin session so calls work out of the box (needs the admin key in Settings).
  useEffect(() => {
    v.auth
      .adminSession()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  const runRef = useRef<() => void>(() => {});
  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
    if (configured.current) return;
    configured.current = true;
    const ts = monaco.languages.typescript;
    ts.typescriptDefaults.setCompilerOptions({
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowNonTsExtensions: true,
      strict: false,
    });
    // 1108 = "return outside function" — we wrap the body in an async IIFE before running.
    ts.typescriptDefaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [1108] });
    ts.typescriptDefaults.addExtraLib(DECLS, 'file:///vencura-playground.d.ts');
  };

  const load = (i: number) => {
    setActive(i);
    setCode(EXAMPLES[i].code);
    setOut('');
  };

  const run = useCallback(async () => {
    setBusy(true);
    setOut('');
    setElapsed(0);
    const lines: string[] = [];
    // Stream logs live so on-chain waits show progress instead of a frozen "running…".
    const log = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'object' ? show(a) : String(a))).join(' '));
      setOut(lines.join('\n'));
    };
    const t0 = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 250);
    try {
      const js = transform(`(async () => {\n${code}\n})()`, { transforms: ['typescript'] }).code;
      const fn = new Function('v', 'log', 'parseEther', 'recoverMessageAddress', 'NATIVE_ASSET', `return ${js}`);
      const result = await fn(v, log, parseEther, recoverMessageAddress, NATIVE_ASSET);
      const tail = result === undefined ? '' : `${lines.length ? '\n\n' : ''}${show(result)}`;
      setOut(`${lines.join('\n')}${tail}` || '✓ done (no return value)');
    } catch (e) {
      const err = e as { name?: string; message?: string; code?: string };
      setOut(`${lines.length ? `${lines.join('\n')}\n\n` : ''}✗ ${err.name ?? 'Error'}: ${err.message ?? String(e)}${err.code ? ` [${err.code}]` : ''}`);
    } finally {
      window.clearInterval(timer);
      setBusy(false);
    }
  }, [code]);
  runRef.current = run;

  return (
    <main className="app">
      <header className="app-head">
        <div>
          <h1>SDK Playground</h1>
          <p className="bal-sub">
            A live TypeScript interpreter over <code>@vencura/sdk</code>. <code>v</code> is the client,{' '}
            <code>log(…)</code> prints, the last <code>return</code> is shown. {authed ? '✓ signed in (demo admin)' : 'signing in…'}{' '}
            · ⌘/Ctrl-Enter to run.
          </p>
        </div>
        <button type="button" className="copybtn" onClick={onExit}>
          ← back
        </button>
      </header>

      <div className="pg2-wrap">
        <nav className="pg2-files" aria-label="examples">
          {EXAMPLES.map((e, i) => (
            <button key={e.file} type="button" className={i === active ? 'pg2-file on' : 'pg2-file'} onClick={() => load(i)}>
              {e.file}
              {e.mutates && <span className="pg2-tag" title="broadcasts a real Sepolia transaction">tx</span>}
            </button>
          ))}
        </nav>

        <div className="pg2-main">
          <div className="pg2-editor">
            <Editor
              language="typescript"
              theme="vs"
              value={code}
              onChange={(val) => setCode(val ?? '')}
              onMount={onMount}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                padding: { top: 10 },
              }}
            />
          </div>

          <div className="pg2-runrow">
            <button className="pg2-run" onClick={() => void run()} disabled={busy}>
              {busy ? `Running… ${elapsed}s` : 'Run ▶  (⌘/Ctrl-Enter)'}
            </button>
            <button
              type="button"
              className="copybtn"
              onClick={() => setCode(ex.code)}
              disabled={busy || code === ex.code}
              title="restore this example's original code"
            >
              Reset
            </button>
            {busy && (
              <span className="pg2-status">
                ⏳ {elapsed}s{ex.mutates ? ' · broadcasting + waiting for on-chain confirmation (~15–30s)' : ' · calling the API'}
              </span>
            )}
          </div>

          <pre className="pg2-output">{out || '— output —'}</pre>

          {/* Reviewer aid: how this example maps to the take-home requirements. */}
          <section className="pg2-maps" aria-label="how this maps to the brief">
            <span className={ex.req ? 'pg2-reqtag req' : 'pg2-reqtag'}>{ex.req ? 'Required' : 'Beyond brief'}</span>
            <code className="pg2-req">{ex.maps}</code>
            <p className="pg2-note">{ex.note}</p>
            <div className="pg2-flow">
              {ex.flow.map((step, i) => (
                <span key={step} className="pg2-flowstep">
                  {i > 0 && <span className="pg2-arrow">→</span>}
                  <span className="pg2-pill">{step}</span>
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
