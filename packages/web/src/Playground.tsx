import { useCallback, useState } from 'react';
import { v } from './vencura';

// Runnable snippets the editor can load. `v` is the live SDK client; `log(...)` prints to the output;
// the last `return` value is shown (BigInt-safe). These run against the real API with your session.
const SNIPPETS: { label: string; code: string }[] = [
  { label: 'Login (demo admin)', code: `return await v.auth.login({ email: 'admin@vencura.local', password: 'demo-password' });` },
  { label: 'Who am I', code: `return await v.auth.me();` },
  { label: 'My wallet', code: `const ws = await v.wallets.list();\nreturn ws[0] ?? await v.wallets.provision();` },
  { label: 'Balance', code: `const [w] = await v.wallets.list();\nreturn await v.wallets.getBalance({ walletId: w.id });` },
  {
    label: 'Sign + verify',
    code: `const [w] = await v.wallets.list();\nconst { signature } = await v.wallets.signMessage({ walletId: w.id, message: 'gm from the playground' });\nlog('signature', signature);\nreturn signature;`,
  },
  {
    label: 'Send 1 wei + confirm',
    code: `const [w] = await v.wallets.list();\nlog('sending 1 wei to self, waiting for confirmation…');\nreturn await v.transactions.sendAndConfirm({ walletId: w.id, to: w.address, asset: 'ETH', amount: '1' });`,
  },
  { label: 'Recent activity', code: `const [w] = await v.wallets.list();\nreturn (await v.activity.forWallet({ walletId: w.id })).slice(0, 5);` },
  {
    label: 'Token supply',
    code: `const t = await v.tokens.get();\nif (!t) return 'no token deployed';\nreturn {\n  totalSupply: await v.tokens.totalSupply({ token: t.address }),\n  ownerHolds: await v.tokens.balanceOf({ token: t.address, owner: t.owner }),\n};`,
  },
  { label: 'Chain head', code: `return await v.chain.head();` },
];

// JSON.stringify chokes on BigInt — render it as "123n" so token/allowance amounts show.
const show = (x: unknown): string =>
  JSON.stringify(x, (_k, val) => (typeof val === 'bigint' ? `${val}n` : val), 2);

// The SDK surface, for reference while tinkering.
const SURFACE: Record<string, string[]> = {
  auth: ['login', 'register', 'me', 'accounts', 'singleUser', 'logout'],
  wallets: ['provision', 'list', 'holders', 'getBalance', 'signMessage', 'getPolicy', 'setPolicy'],
  transactions: ['send', 'sendAndConfirm', 'waitForConfirmation', 'list', 'contractRead', 'contractWrite'],
  tokens: ['get', 'deploy', 'transfer', 'approve', 'allowance', 'balanceOf', 'totalSupply', 'transferFrom'],
  activity: ['forWallet', 'all', 'events'],
  chain: ['head'],
  admin: ['createAccount', 'seed', 'reset'],
};

export function Playground({ onExit }: { onExit: () => void }) {
  const [code, setCode] = useState(SNIPPETS[1].code);
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setOut('running…');
    const lines: string[] = [];
    const log = (...args: unknown[]) =>
      lines.push(args.map((a) => (typeof a === 'object' ? show(a) : String(a))).join(' '));
    try {
      // Deliberate eval: this is an SDK playground — `v` and `log` are injected, the code is the user's.
      const fn = new Function('v', 'log', `return (async () => {\n${code}\n})();`) as (
        client: typeof v,
        log: (...a: unknown[]) => void,
      ) => Promise<unknown>;
      const result = await fn(v, log);
      const body = result === undefined ? '(no return value)' : show(result);
      setOut((lines.length ? `${lines.join('\n')}\n\n` : '') + body);
    } catch (e) {
      const err = e as { name?: string; message?: string; code?: string };
      setOut(`${lines.length ? `${lines.join('\n')}\n\n` : ''}✗ ${err.name ?? 'Error'}: ${err.message ?? e}${err.code ? ` [${err.code}]` : ''}`);
    } finally {
      setBusy(false);
    }
  }, [code]);

  return (
    <main className="app">
      <header className="app-head">
        <div>
          <h1>SDK Playground</h1>
          <p className="bal-sub">
            Tinker with <code>@vencura/sdk</code> live against the API. <code>v</code> is the client,{' '}
            <code>log(…)</code> prints, and the last <code>return</code> is shown. Uses your current session —
            run <em>Login (demo admin)</em> first if you get a 401. ⌘/Ctrl-Enter to run.
          </p>
        </div>
        <button type="button" className="copybtn" onClick={onExit}>
          ← back
        </button>
      </header>

      <div className="pg-snippets">
        {SNIPPETS.map((s) => (
          <button key={s.label} type="button" className="pill-btn" onClick={() => setCode(s.code)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="pg-grid">
        <div className="pg-pane">
          <label className="cap" htmlFor="pg-code">
            Code
          </label>
          <textarea
            id="pg-code"
            className="pg-editor"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void run();
            }}
          />
          <button onClick={() => void run()} disabled={busy}>
            {busy ? 'Running…' : 'Run ▶'}
          </button>
        </div>
        <div className="pg-pane">
          <span className="cap">Output</span>
          <pre className="pg-output">{out || '— run something —'}</pre>
        </div>
      </div>

      <details className="pg-ref">
        <summary>SDK surface</summary>
        <div className="pg-ref-grid">
          {Object.entries(SURFACE).map(([domain, methods]) => (
            <div key={domain}>
              <strong>v.{domain}</strong>
              <ul>
                {methods.map((m) => (
                  <li key={m}>
                    <code>
                      {domain}.{m}()
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </main>
  );
}
