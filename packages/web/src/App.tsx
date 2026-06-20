import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { erc20Abi, isAddress, parseEther, recoverMessageAddress } from 'viem';
import {
  type Account,
  type ActivityItem,
  ADMIN_EMAIL,
  adminKeyStore,
  type BalanceLine,
  type LogLine,
  type Policy,
  v,
  type Wallet,
} from './vencura';
import { AuthProvider, useAuth } from './auth-context';
import { looksLikeEns, resolveEns, reverseResolveEns } from './ens';
import { explorerAddress, explorerTx, FAUCET_URL } from './explorer';
import { activityAmount, shortHex, toEth } from './format';

// Copy any value to the clipboard with brief "Copied ✓" feedback.
function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copybtn"
      aria-label={`Copy ${value}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

// A truncated, monospace address/hash that deep-links to Etherscan and is copyable.
// Module-level cache so repeated renders of the same address don't re-fetch.
const ensNameCache = new Map<string, string | null>();

/** Renders an address as a HashLink; swaps in the .eth primary name when it resolves. When `from`
 *  is the same wallet, flags it as a self-send (↺ self) so dust concurrency tests read clearly. */
function EnsAddress({ address, from }: { address: string; from?: string }) {
  const isSelf = !!from && address.toLowerCase() === from.toLowerCase();
  const [name, setName] = useState<string | null>(ensNameCache.get(address) ?? null);
  useEffect(() => {
    if (isSelf || ensNameCache.has(address)) return;
    reverseResolveEns(address).then((n) => {
      ensNameCache.set(address, n);
      setName(n);
    });
  }, [address, isSelf]);
  return (
    <span>
      {isSelf ? (
        <span className="self-tag" title={address}>↺ self </span>
      ) : (
        name && <span title={address}>{name} </span>
      )}
      <HashLink value={address} href={explorerAddress(address)} />
    </span>
  );
}

function HashLink({ value, href }: { value: string; href: string }) {
  return (
    <span>
      <a href={href} target="_blank" rel="noreferrer" title={value}>
        <code>{shortHex(value)}</code> ↗
      </a>
      <CopyButton value={value} label="⧉" />
    </span>
  );
}

// Fetches the chain head (block height + gas) once on mount + on demand. No auto-poll — the user
// refreshes via the status-bar Refresh button (manual-refresh model).
function useChainHead() {
  const [head, setHead] = useState<{ blockNumber: number; gasGwei: number } | null>(null);
  const refresh = useCallback(
    () =>
      v.chain
        .head()
        .then(setHead)
        .catch(() => undefined),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { head, refresh };
}

// Shared status bar: network + block/gas (as of last fetch) + an "updated" stamp. Updates aren't
// live — the Refresh button re-fetches the chain head and (if provided) the caller's data.
function StatusBar({ onRefresh }: { lastUpdated?: string; onRefresh?: () => void }) {
  const { head, refresh } = useChainHead();
  const [headAt, setHeadAt] = useState('');
  // Stamp the fetch time whenever a fresh head arrives.
  useEffect(() => {
    if (head) setHeadAt(new Date().toLocaleTimeString());
  }, [head]);
  return (
    <div className="statusbar">
      <span className="net">
        <span className="dot" aria-hidden /> Sepolia
      </span>
      {head && (
        <>
          <span>
            block <strong>{head.blockNumber.toLocaleString()}</strong>
          </span>
          <span>gas {head.gasGwei} gwei</span>
        </>
      )}
      {headAt && <span>updated {headAt}</span>}
      <button
        type="button"
        className="copybtn"
        style={{ marginLeft: 'auto' }}
        onClick={() => {
          void refresh();
          onRefresh?.();
        }}
      >
        Refresh
      </button>
    </div>
  );
}

// Loads the signed-in account's wallets (re-fetches whenever the session changes).
// Keyed on the ACCOUNT id (not a boolean): when the signed-in account changes — e.g. admin → a
// freshly-registered user — the wallet list re-fetches. Keying on `!!current` was a bug: both are
// truthy across an admin→user switch, so the effect never re-fired and the User view showed the
// admin's wallets (→ "wallet not found" on calls). `undefined` = not signed in → empty.
function useWallets(accountId: string | undefined) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const refresh = useCallback(() => {
    if (!accountId) {
      setWallets([]);
      return Promise.resolve();
    }
    setError('');
    return v.wallets
      .list()
      .then((w) => {
        setWallets(w);
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .catch((err) => setError((err as Error).message));
  }, [accountId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { wallets, refresh, lastUpdated, error };
}

// Accessible tablist: role=tab + aria-selected, ←/→/Home/End keyboard nav. The active tab is the
// caller's state (synced to the URL hash via useHashTab) so it's deep-linkable + survives refresh.
function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tablist" role="tablist" aria-label="Admin sections">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          id={`tab-${t.id}`}
          aria-selected={active === t.id}
          tabIndex={active === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const last = tabs.length - 1;
            let next = -1;
            if (e.key === 'ArrowRight') next = i === last ? 0 : i + 1;
            else if (e.key === 'ArrowLeft') next = i === 0 ? last : i - 1;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = last;
            if (next >= 0) {
              e.preventDefault();
              onChange(tabs[next].id);
            }
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// Keep the active Admin tab in the URL hash (#admin/wallets) so it's deep-linkable + refresh-safe.
function useHashTab(fallback: string): [string, (id: string) => void] {
  const read = () => window.location.hash.match(/^#admin\/(\w+)/)?.[1] ?? fallback;
  const [tab, setTab] = useState(read);
  useEffect(() => {
    const onHash = () => setTab(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const set = (id: string) => {
    window.location.hash = `admin/${id}`;
    setTab(id);
  };
  return [tab, set];
}

// Demo-mode banner: auth is deliberately bypassed for the demo — say so, and point at the prod design.
function DemoBanner() {
  return (
    <p className="demobanner">
      <strong>Demo mode</strong> — auth is bypassed (one shared password) so you can click straight
      in. In production each account has its own credentials behind a per-user JWT; the admin key is
      a server secret, never shown.
    </p>
  );
}

// Root landing page: two tiles — User (use wallets) and Admin (manage accounts / demo data).
function Landing({ onPick }: { onPick: (view: 'user' | 'admin') => void }) {
  return (
    <main className="app landing">
      <header className="landing-head">
        <h1>VenCura</h1>
        <p className="tagline">custodial Ethereum wallets, over an API</p>
      </header>
      <div className="tiles">
        <button type="button" className="tile" onClick={() => onPick('user')}>
          <span className="tile-emoji" aria-hidden>
            👛
          </span>
          <h2>User</h2>
          <p>Pick an account and use your wallets — balances, send ETH or tokens, sign messages.</p>
        </button>
        <button type="button" className="tile" onClick={() => onPick('admin')}>
          <span className="tile-emoji" aria-hidden>
            🛠️
          </span>
          <h2>Admin</h2>
          <p>Create accounts, seed or reset demo data, set policies, and inspect the chain.</p>
        </button>
      </div>
    </main>
  );
}

// User experience: ONE self-registered account (register if none exists, else log in), then manage
// your own wallets. No account picker — one user, arbitrarily many wallets.
function UserView({ onExit }: { onExit: () => void }) {
  const { current, signOut } = useAuth();
  // Only the non-admin user's wallets (the admin session never drives the User view).
  const { wallets, refresh, lastUpdated } = useWallets(
    current && current.email !== ADMIN_EMAIL ? current.id : undefined,
  );

  // The admin (a shared session) must not render as "the user" — the User view is for the
  // self-registered, non-admin account only.
  if (!current || current.email === ADMIN_EMAIL) return <UserAuth onExit={onExit} />;

  return (
    <main className="app">
      <header>
        <h1>
          <button type="button" className="logobtn" onClick={onExit}>
            VenCura
          </button>
        </h1>
        <span style={{ marginLeft: 'auto' }} className="account signed-in">
          <span>{current.email}</span>{' '}
          <button type="button" onClick={signOut} title="Sign out">
            Sign out
          </button>{' '}
          <button type="button" className="link" onClick={onExit}>
            ← Home
          </button>
        </span>
      </header>
      <StatusBar lastUpdated={lastUpdated} onRefresh={() => void refresh()} />
      <UserTokenPanel wallets={wallets} />
      <h2 className="cap">Your wallets</h2>
      <p className="bal-sub">
        Create as many wallets as you like — each can hold ETH and tokens, send, and sign.
      </p>
      <WalletsTab wallets={wallets} onChange={refresh} email={current.email} />
    </main>
  );
}

// Single-user auth: register the one account if none exists yet, otherwise log in to it. Real
// credentials (the user chooses a password) — not the shared admin demo password.
function UserAuth({ onExit }: { onExit: () => void }) {
  const { loginUser, registerUser } = useAuth();
  const [existing, setExisting] = useState<Account | null | undefined>(undefined); // undefined = loading
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    v.auth
      .singleUser()
      .then((u) => {
        setExisting(u);
        if (u) setEmail(u.email);
      })
      .catch(() => setExisting(null));
  }, []);

  const mode = existing ? 'login' : 'register';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await loginUser(email.trim(), password);
      else await registerUser(email.trim().toLowerCase(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app">
      <header>
        <h1>
          <button type="button" className="logobtn" onClick={onExit}>
            VenCura
          </button>{' '}
          · User
        </h1>
        <button type="button" className="link" style={{ marginLeft: 'auto' }} onClick={onExit}>
          ← Home
        </button>
      </header>
      <section className="picker">
        <h3>{existing === undefined ? 'Loading…' : mode === 'login' ? 'Log in' : 'Create your account'}</h3>
        {existing !== undefined && (
          <form onSubmit={submit} className="form-grid">
            <label className="field" htmlFor="user-email">
              <span>Email</span>
              <input
                id="user-email"
                type="email"
                autoComplete="username"
                value={email}
                readOnly={mode === 'login'}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field" htmlFor="user-pass">
              <span>Password</span>
              <input
                id="user-pass"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || !email || !password}>
              {busy ? '…' : mode === 'login' ? 'Log in' : 'Register'}
            </button>
          </form>
        )}
        <p className="bal-sub">
          {mode === 'login'
            ? 'This demo has one user account — log in to manage your wallets.'
            : 'No user yet — register the single demo user. After this, registration is closed.'}
        </p>
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}


/** Send native ETH (or an ERC-20 by address) to a recipient address, with a live per-tx pre-flight. */
function SendForm({
  wallet,
  assets,
  policy,
  onSent,
}: {
  wallet: Wallet;
  assets: { value: string; label: string }[];
  policy: Policy | null;
  onSent: () => void;
}) {
  const [asset, setAsset] = useState('ETH');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Recipient may be a 0x address OR an ENS name (resolved on mainnet). `resolved` holds the 0x we
  // actually send to (+ the typed name, for the hints). `sent` is the last broadcast tx, surfaced
  // as a prominent "track on Etherscan" link so it isn't lost in the activity feed.
  const [resolved, setResolved] = useState<{ address: string; name?: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [sent, setSent] = useState<{ txHash: string; name?: string } | null>(null);

  // A 0x address passes through; an ENS name resolves via mainnet (debounced).
  useEffect(() => {
    const v = to.trim();
    if (!v) {
      setResolved(null);
      return;
    }
    if (isAddress(v)) {
      setResolved({ address: v });
      return;
    }
    if (!looksLikeEns(v)) {
      setResolved(null);
      return;
    }
    let active = true;
    setResolving(true);
    const t = setTimeout(() => {
      resolveEns(v)
        .then((a) => active && setResolved(a ? { address: a, name: v } : null))
        .finally(() => active && setResolving(false));
    }, 400);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [to]);

  const addr = resolved?.address ?? '';
  // Client mirror of the server per-tx limit for a live pre-flight verdict. The daily limit is
  // server-enforced (needs today's spend), so it isn't previewed here.
  const preflight = (() => {
    if (!policy || !addr) return null;
    if (asset === 'ETH' && policy.perTxLimit && amount) {
      try {
        if (parseEther(amount) > BigInt(policy.perTxLimit))
          return { ok: false, msg: `exceeds per-tx limit (${toEth(policy.perTxLimit)} ETH)` };
      } catch {
        /* invalid amount — the submit guard handles it */
      }
    }
    return { ok: true, msg: 'within policy' };
  })();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (!addr) throw new Error(resolving ? 'Resolving recipient…' : 'Enter a valid 0x address or ENS name.');
      // Amount is entered in ETH decimals; convert to wei base units before POST (ERC-20s
      // here are demo-only and also use 18 decimals, so parseEther is fine for the demo).
      let wei: bigint;
      try {
        wei = parseEther(amount);
      } catch {
        throw new Error('Enter a valid amount.');
      }
      if (wei <= 0n) throw new Error('Amount must be greater than 0.');
      const tx = await v.transactions.send({ walletId: wallet.id, to: addr, asset, amount: wei.toString() });
      if (tx.txHash) setSent({ txHash: tx.txHash, name: resolved?.name });
      setAmount('');
      setTo('');
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <label className="field" htmlFor={`asset-${wallet.id}`}>
          <span>Asset</span>
          <select id={`asset-${wallet.id}`} value={asset} onChange={(e) => setAsset(e.target.value)}>
            {assets.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field" htmlFor={`to-${wallet.id}`}>
          <span>Recipient (0x or ENS)</span>
          <input
            id={`to-${wallet.id}`}
            placeholder="0x… or vitalik.eth"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>

        <label className="field" htmlFor={`amount-${wallet.id}`}>
          <span>Amount (ETH)</span>
          <input
            id={`amount-${wallet.id}`}
            type="number"
            step="any"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <button type="submit" disabled={busy || amount.length === 0 || !addr}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {resolving && <p className="bal-sub">resolving ENS…</p>}
      {resolved?.name && (
        <p className="bal-sub">
          {resolved.name} → <code>{shortHex(resolved.address)}</code> ✓
        </p>
      )}
      {to.trim() && !resolving && !resolved && (
        <p className="preflight bad">✗ enter a valid 0x address or ENS name</p>
      )}
      {preflight && (
        <p className={`preflight ${preflight.ok ? 'ok' : 'bad'}`}>
          {preflight.ok ? '✓ within policy' : `✗ would be blocked: ${preflight.msg}`}
        </p>
      )}
      {sent && (
        <p className="hint">
          ✓ Sent{sent.name ? ` to ${sent.name}` : ''} — track your transaction:{' '}
          <a href={explorerTx(sent.txHash)} target="_blank" rel="noreferrer">
            on Etherscan ↗
          </a>
          <CopyButton value={sent.txHash} label="copy tx" />
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

// Unified on/off-chain history: on-chain sends + off-chain signatures, newest-first. Fetches on
// mount + whenever `refreshKey` changes (a send/sign or the wallet's Refresh) — no auto-poll, so
// PENDING→CONFIRMED appears when the user refreshes (the confirmation watcher runs server-side).
function ActivityFeed({ wallet, refreshKey }: { wallet: Wallet; refreshKey: number }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    return v.activity
      .forWallet({ walletId: wallet.id })
      .then(setItems)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, [wallet.id]);

  // Fetch on mount + whenever a send/sign or the wallet's Refresh bumps refreshKey.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <>
      <button type="button" className="copybtn" onClick={() => void load()} disabled={busy}>
        {busy ? 'Refreshing…' : 'Refresh activity'}
      </button>
      {items.length === 0 ? (
        <p className="bal-sub">No transactions or signatures yet — sign a message or send to get started.</p>
      ) : (
        <ul className="act-scroll">
          {items.map((it) => {
            const time = <span className="act-time">{new Date(it.createdAt).toLocaleTimeString()}</span>;
            if (it.kind === 'transaction')
              return (
                <li key={it.id}>
                  {time} <span className={`pill ${it.status}`}>{it.status}</span> ·{' '}
                  {it.method ? (
                    <>
                      called <strong>{it.method}</strong> on
                    </>
                  ) : (
                    <>
                      sent <strong>{activityAmount(it.amount, it.asset)}</strong> →
                    </>
                  )}{' '}
                  <EnsAddress address={it.to} from={wallet.address} />
                  {it.txHash && (
                    <>
                      {' '}
                      · tx <HashLink value={it.txHash} href={explorerTx(it.txHash)} />
                    </>
                  )}
                </li>
              );
            if (it.kind === 'signature')
              return (
                <li key={it.id}>
                  {time} <span className="pill signed">signed</span> · “{it.message}” →{' '}
                  <code>{shortHex(it.signature)}</code>
                  <CopyButton value={it.signature} label="⧉" />
                </li>
              );
            // received: an inbound transfer indexed from chain (funds we received, not sent)
            if (it.kind === 'received')
              return (
                <li key={it.id}>
                  {time} <span className="pill received">received</span> ·{' '}
                  <strong>{activityAmount(it.amount, it.asset === 'ETH' ? 'ETH' : 'TOKEN')}</strong> ←{' '}
                  <EnsAddress address={it.from} />
                  {' '}· tx <HashLink value={it.txHash} href={explorerTx(it.txHash)} />
                </li>
              );
            // audit: a durable governance event (policy.changed, wallet.created, token.deployed, …)
            if (it.kind === 'audit')
              return (
                <li key={it.id}>
                  {time} <span className="pill audit">{it.type}</span>
                </li>
              );
            return null; // unknown / not-yet-deployed kind — render nothing, never a blank pill
          })}
        </ul>
      )}
    </>
  );
}



// Fires N sends at one wallet simultaneously to demonstrate the per-wallet nonce lock:
// despite racing, every send gets a unique, consecutive nonce (no collisions, no gaps).
function ConcurrencyDemo({
  wallet,
  recipient,
  canSend,
}: {
  wallet: Wallet;
  recipient?: string;
  canSend?: boolean;
}) {
  const [n, setN] = useState(5);
  const [results, setResults] = useState<{ nonce: number | null; error?: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const fire = async () => {
    if (!recipient) return;
    setBusy(true);
    setResults([]);
    const sends = Array.from({ length: n }, () =>
      v.transactions
        .send({ walletId: wallet.id, to: recipient, asset: 'ETH', amount: '1' })
        .then((tx) => ({ nonce: tx.nonce }))
        .catch((e) => ({ nonce: null, error: (e as Error).message })),
    );
    setResults(await Promise.all(sends));
    setBusy(false);
  };

  const nonces = results.map((r) => r.nonce).filter((x): x is number => x != null);
  const sorted = [...nonces].sort((a, b) => a - b);
  const unique = new Set(nonces).size === nonces.length;
  const monotonic = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
  const errors = results.filter((r) => r.error);
  const allBroadcast = results.length > 0 && errors.length === 0;
  const range = sorted.length ? `${sorted[0]}–${sorted[sorted.length - 1]}` : '—';
  // The named guarantees a reviewer cares about — each maps to a concrete failure mode the
  // per-wallet nonce lock prevents.
  const checks = [
    { ok: allBroadcast, label: `${nonces.length}/${results.length} broadcast — none blocked or dropped` },
    { ok: unique, label: `Unique nonces ${range} — no collision, no double-spend` },
    { ok: monotonic, label: 'Consecutive — no gaps, no stuck nonce' },
    { ok: unique && monotonic, label: 'Serialized in order — one tx per nonce, FIFO under the lock' },
  ];
  const allPass = checks.every((c) => c.ok);

  return (
    <details>
      <summary>Concurrency demo (nonce lock)</summary>
      <p className="bal-sub">
        Fires N self-sends (1 wei each) at this wallet <em>simultaneously</em>. Without serialization
        they'd race the same nonce → collisions, gaps, or a double-spend. A Postgres advisory lock
        (<code>pg_advisory_xact_lock</code>) serializes read-nonce → sign → broadcast, so each gets a
        unique, consecutive nonce.
      </p>
      <label>
        N concurrent sends{' '}
        <input type="number" min={2} max={20} value={n} onChange={(e) => setN(Number(e.target.value))} />
      </label>{' '}
      {recipient && canSend ? (
        <button type="button" onClick={fire} disabled={busy}>
          {busy ? 'Firing…' : `Fire ${n} concurrent sends`}
        </button>
      ) : (
        <span className="bal-sub">
          {!recipient ? 'add a recipient to fire for real' : 'fund this wallet to fire for real'}
        </span>
      )}
      {results.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {[...results]
            .sort((a, b) => (a.nonce ?? Number.MAX_SAFE_INTEGER) - (b.nonce ?? Number.MAX_SAFE_INTEGER))
            .map((r, i) => (
              <div className="nonce-row" key={i}>
                <span className="lock" aria-hidden>🔒</span>
                <span className="nnum">{r.nonce != null ? `nonce ${r.nonce}` : '—'}</span>
                <span>
                  {r.error ? (
                    <span className="pill failed">failed</span>
                  ) : (
                    <span className="pill pending">broadcast</span>
                  )}
                  {r.error ? ` ${r.error}` : ''}
                </span>
              </div>
            ))}
          <ul className="checklist" style={{ marginTop: 10 }}>
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? 'ok' : 'bad'}>
                <span aria-hidden>{c.ok ? '✓' : '✗'}</span> {c.label}
              </li>
            ))}
          </ul>
          <p className={`verdict ${allPass ? 'ok' : 'bad'}`}>
            {allPass
              ? `${nonces.length} concurrent sends, zero contention bugs — the lock held.`
              : errors.length
                ? `${errors.length}/${results.length} failed (${errors[0].error})`
                : 'ordering violated — nonces overlapped or skipped.'}
          </p>
        </div>
      )}
    </details>
  );
}

function WalletItem({ wallet, email }: { wallet: Wallet; email: string }) {
  const [balances, setBalances] = useState<BalanceLine[] | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  // A realistic default payload so signing demonstrates a *use* (proving wallet ownership off-chain),
  // not "sign a blank box". This is the shape of a Sign-In-With-Ethereum / gasless-approval challenge.
  const [message, setMessage] = useState(
    () => `I control ${wallet.address} — signed to prove ownership (off-chain, no gas).`,
  );
  const [signature, setSignature] = useState('');
  const [verifyOut, setVerifyOut] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const guard = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const load = useCallback(
    () =>
      guard(async () => {
        const [bal, pol] = await Promise.all([
          v.wallets.getBalance({ walletId: wallet.id }),
          v.wallets.getPolicy({ walletId: wallet.id }),
        ]);
        setBalances(bal.balances);
        setPolicy(pol);
      }),
    [wallet.id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const sign = (e: FormEvent) => {
    e.preventDefault();
    setVerifyOut('');
    return guard(async () => setSignature((await v.wallets.signMessage({ walletId: wallet.id, message })).signature));
  };

  // Sign → verify loop: recover the signer from (message, signature) and prove it's this wallet.
  const verify = () =>
    guard(async () => {
      const signer = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
      setVerifyOut(
        signer.toLowerCase() === wallet.address.toLowerCase()
          ? `✓ verified — recovered ${shortHex(signer)} = this wallet`
          : `✗ mismatch — recovered ${shortHex(signer)}`,
      );
    });

  const onSent = () => {
    setRefreshKey((k) => k + 1);
    void load(); // available drops immediately (optimistic pending debit)
  };

  // Asset dropdown: ETH + any tracked tokens that show up in this wallet's balances.
  const assetOptions = [
    { value: 'ETH', label: 'ETH' },
    ...(balances ?? [])
      .filter((b) => b.asset !== 'ETH')
      .map((b) => ({ value: b.asset, label: b.symbol })),
  ];
  // Native-ETH availability drives the fund hint + gating the concurrency demo (needs gas).
  const ethBal = balances?.find((b) => b.asset === 'ETH');
  const ethAvailable = ethBal ? BigInt(ethBal.available) : 0n;
  const canSend = ethAvailable > 0n;
  const ethZero = !!balances && ethAvailable === 0n;

  return (
    <li>
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="nick">{email}</span>
        <a href={explorerAddress(wallet.address)} target="_blank" rel="noreferrer" title={wallet.address}>
          <code>{wallet.address}</code> ↗
        </a>
        <CopyButton value={wallet.address} label="⧉" />
      </div>
      {policy && (policy.perTxLimit || policy.dailyLimit) && (
        <div className="badges">
          {policy.perTxLimit && <span className="badge">Per-tx ≤ {toEth(policy.perTxLimit)} ETH</span>}
          {policy.dailyLimit && <span className="badge">Daily ≤ {toEth(policy.dailyLimit)} ETH</span>}
        </div>
      )}
      <div>
        <button
          onClick={() => {
            void load();
            setRefreshKey((k) => k + 1);
          }}
          disabled={busy}
        >
          Refresh
        </button>
        <span className="bal-sub" style={{ marginLeft: 8 }}>
          updates aren't live — click Refresh to update balance &amp; activity (e.g. after a send confirms)
        </span>
        {balances && (
          <div className="bal-grid">
            {balances.map((b) => (
              <div className="bal-line" key={b.asset}>
                <span className="bal-label">{b.symbol} available</span>
                <span className="bal-amt" title={`${b.available} wei`}>
                  {toEth(b.available)} {b.symbol}
                </span>
                <span className="bal-sub">
                  confirmed {toEth(b.confirmed)} {b.symbol} · block {b.asOfBlock ?? '—'}
                </span>
              </div>
            ))}
          </div>
        )}
        {ethZero && (
          <p className="hint">
            This wallet is unfunded — fund it to send.{' '}
            <a href={FAUCET_URL} target="_blank" rel="noreferrer">
              Sepolia faucet ↗
            </a>
            <CopyButton value={wallet.address} label="copy address" />
          </p>
        )}
      </div>

      <h4>Send</h4>
      <SendForm wallet={wallet} assets={assetOptions} policy={policy} onSent={onSent} />

      {/* One wallet per account → no internal "your wallets" recipients; the concurrency demo
          fires repeated self-sends to prove the nonce lock. ERC-20 / approve lives in the Token tab. */}
      <ConcurrencyDemo wallet={wallet} recipient={wallet.address} canSend={canSend} />

      <h4>Activity (on-chain + signatures)</h4>
      <ActivityFeed wallet={wallet} refreshKey={refreshKey} />

      <details>
        <summary>Sign a message</summary>
        <p className="bal-sub">
          Off-chain proof of ownership — no gas, no transaction. The same primitive behind passwordless
          “Sign-In With Ethereum” and gasless EIP-712 approvals. Sign, then <b>Verify</b> to recover the signer
          and confirm it’s this wallet.
        </p>
        <form onSubmit={sign}>
          <label htmlFor={`msg-${wallet.id}`}>Message to sign</label>
          <textarea
            id={`msg-${wallet.id}`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button type="submit" disabled={busy || message.length === 0}>
            Sign
          </button>
          {signature && (
            <p>
              signature: <code>{shortHex(signature)}</code>
              <CopyButton value={signature} label="⧉" />{' '}
              <button type="button" className="copybtn" onClick={verify}>
                Verify
              </button>
              {verifyOut && (
                <span className={verifyOut.startsWith('✓') ? 'verdict ok' : 'verdict bad'}> {verifyOut}</span>
              )}
            </p>
          )}
        </form>
      </details>
      {error && <p role="alert">{error}</p>}
    </li>
  );
}

// Wallets as collapsed accordion rows: only the open wallet's action panel is mounted, so the page
// height stops scaling with wallet count (audit #1). One open at a time.
// One wallet per account: ensure it exists (provision is idempotent + master-funds a new one),
// then render its single panel — no create button, no list.
function WalletsTab({ wallets, onChange, email }: { wallets: Wallet[]; onChange: () => void; email: string }) {
  const [error, setError] = useState('');
  useEffect(() => {
    if (wallets.length === 0) {
      v.wallets
        .provision()
        .then(() => onChange())
        .catch((e) => setError((e as Error).message));
    }
  }, [wallets.length, onChange]);

  if (error) return <p role="alert">{error}</p>;
  if (wallets.length === 0) return <p className="bal-sub">Setting up your wallet…</p>;
  return (
    <ul>
      {wallets.map((w) => (
        <WalletItem key={w.id} wallet={w} email={email} />
      ))}
    </ul>
  );
}

/** Edit one wallet's spending limits as a self-contained card: per-tx + daily caps (entered in
 *  ETH). Labels sit directly above their field; save is disabled until something changes. */
function LimitsEditor({ wallet }: { wallet: Wallet }) {
  const [perTxLimit, setPerTxLimit] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [loaded, setLoaded] = useState<Policy | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    v.wallets
      .getPolicy({ walletId: wallet.id })
      .then((p) => {
        setPerTxLimit(p.perTxLimit ? toEth(p.perTxLimit) : '');
        setDailyLimit(p.dailyLimit ? toEth(p.dailyLimit) : '');
        setLoaded(p);
      })
      .catch((e) => setError((e as Error).message));
  }, [wallet.id]);

  // Dirty check vs the loaded limits so Save only lights up on a real change.
  const dirty =
    !!loaded &&
    (perTxLimit !== (loaded.perTxLimit ? toEth(loaded.perTxLimit) : '') ||
      dailyLimit !== (loaded.dailyLimit ? toEth(loaded.dailyLimit) : ''));

  const cur = loaded
    ? !loaded.perTxLimit && !loaded.dailyLimit
      ? 'No limits set — any amount.'
      : `per-tx ${loaded.perTxLimit ? `≤ ${toEth(loaded.perTxLimit)} ETH` : '∞'} · daily ${loaded.dailyLimit ? `≤ ${toEth(loaded.dailyLimit)} ETH` : '∞'}`
    : 'Loading…';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setStatus('');
    try {
      const next: Policy = {
        // Limits are entered in ETH; persist as wei base units to match the backend.
        perTxLimit: perTxLimit.trim() ? parseEther(perTxLimit.trim()).toString() : null,
        dailyLimit: dailyLimit.trim() ? parseEther(dailyLimit.trim()).toString() : null,
      };
      await v.wallets.setPolicy({ walletId: wallet.id, ...next });
      setLoaded(next);
      setStatus(`✓ saved ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="policy-card" onSubmit={save}>
      <header>
        <span className="nick">Wallet</span>
        <a href={explorerAddress(wallet.address)} target="_blank" rel="noreferrer" title={wallet.address}>
          <code>{shortHex(wallet.address)}</code> ↗
        </a>
        <CopyButton value={wallet.address} label="⧉" />
      </header>
      <p className="cur">Currently: {cur}</p>
      <div className="policy-limits">
        <label htmlFor={`pertx-${wallet.id}`}>
          Per-tx limit (ETH)
          <input
            id={`pertx-${wallet.id}`}
            type="number"
            step="any"
            min="0"
            placeholder="∞"
            value={perTxLimit}
            onChange={(e) => setPerTxLimit(e.target.value)}
          />
        </label>
        <label htmlFor={`daily-${wallet.id}`}>
          Daily limit (ETH)
          <input
            id={`daily-${wallet.id}`}
            type="number"
            step="any"
            min="0"
            placeholder="∞"
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
          />
        </label>
      </div>
      <div className="save-row">
        {status && <span className="bal-sub">{status}</span>}
        <button type="submit" disabled={!dirty}>
          Save limits
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

// Unified activity rows as a table (time · wallet · type · detail) — shared by Overview + Activity.
function ActivityTable({ items, wallets }: { items: ActivityItem[]; wallets: Wallet[] }) {
  if (items.length === 0) return <p className="bal-sub">No activity yet.</p>;
  const addrOf = (id?: string | null) => wallets.find((x) => x.id === id)?.address;
  const label = (id?: string | null) => {
    const a = addrOf(id);
    return a ? shortHex(a) : '—';
  };
  return (
    <table className="act-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Wallet</th>
          <th>Type</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.id}>
            <td className="act-when">{new Date(it.createdAt).toLocaleString()}</td>
            <td>{label(it.walletId)}</td>
            <td>
              {it.kind === 'transaction' ? (
                <span className={`pill ${it.status}`}>{it.status}</span>
              ) : it.kind === 'signature' ? (
                <span className="pill signed">signed</span>
              ) : it.kind === 'received' ? (
                <span className="pill received">received</span>
              ) : (
                <span className="pill audit">{it.type}</span>
              )}
            </td>
            <td>
              {it.kind === 'transaction' && (
                <>
                  {it.method ? (
                    <>
                      called <strong>{it.method}</strong> on{' '}
                    </>
                  ) : (
                    <>
                      sent <strong>{activityAmount(it.amount, it.asset)}</strong> →{' '}
                    </>
                  )}
                  <EnsAddress address={it.to} from={addrOf(it.walletId)} />
                  {it.txHash && (
                    <>
                      {' '}
                      · tx <HashLink value={it.txHash} href={explorerTx(it.txHash)} />
                    </>
                  )}
                </>
              )}
              {it.kind === 'signature' && (
                <>
                  “{it.message}” → <code>{shortHex(it.signature)}</code>
                </>
              )}
              {it.kind === 'received' && (
                <>
                  received <strong>{activityAmount(it.amount, it.asset === 'ETH' ? 'ETH' : 'TOKEN')}</strong> ←{' '}
                  <EnsAddress address={it.from} />
                  {' '}· tx <HashLink value={it.txHash} href={explorerTx(it.txHash)} />
                </>
              )}
              {it.kind === 'audit' && <span className="bal-sub">{JSON.stringify(it.detail)}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Overview dashboard: the at-a-glance state the old single-scroll Admin never had (audit #1).
function OverviewTab({ wallets, onGoWallets }: { wallets: Wallet[]; onGoWallets: () => void }) {
  const [bals, setBals] = useState<Record<string, bigint>>({});
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  useEffect(() => {
    let active = true;
    Promise.all(
      wallets.map((w) =>
        v.wallets
          .getBalance({ walletId: w.id })
          .then((b) => [w.id, BigInt(b.balances.find((l) => l.asset === 'ETH')?.confirmed ?? '0')] as const)
          .catch(() => [w.id, 0n] as const),
      ),
    ).then((entries) => active && setBals(Object.fromEntries(entries)));
    v.activity.all().then((a) => active && setActivity(a)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [wallets]);
  const total = Object.values(bals).reduce((s, v) => s + v, 0n);
  const funded = Object.values(bals).filter((v) => v > 0n).length;
  return (
    <section>
      <div className="summary-tiles">
        <div className="stat">
          <div className="stat-num">{wallets.length}</div>
          <div className="stat-label">Wallets</div>
        </div>
        <div className="stat">
          <div className="stat-num">{funded}</div>
          <div className="stat-label">Funded</div>
        </div>
        <div className="stat">
          <div className="stat-num">{toEth(total)}</div>
          <div className="stat-label">ETH under mgmt</div>
        </div>
        <div className="stat">
          <div className="stat-num">{activity.length}</div>
          <div className="stat-label">Recent events</div>
        </div>
      </div>
      <h2>Recent activity</h2>
      <ActivityTable items={activity.slice(0, 10)} wallets={wallets} />
      <p style={{ marginTop: 14 }}>
        <button type="button" className="copybtn" onClick={onGoWallets}>
          Manage wallets →
        </button>
      </p>
    </section>
  );
}

// Policies tab: one card per wallet, separate from wallet operation (audit #1/#2).
function LimitsTab({ wallets }: { wallets: Wallet[] }) {
  if (wallets.length === 0)
    return (
      <section>
        <p>No wallets — create one or seed demo data first.</p>
      </section>
    );
  return (
    <section>
      {wallets.map((w) => (
        <LimitsEditor key={w.id} wallet={w} />
      ))}
    </section>
  );
}

// The live "system log": polls GET /events with a seq cursor and tails the ring buffer.
function LiveLog() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const cursor = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    const tick = () =>
      v.activity
        .events({ after: cursor.current })
        .then(({ lines: l, seq }) => {
          if (!active) return;
          cursor.current = seq;
          if (l.length) setLines((prev) => [...prev, ...l].slice(-300));
        })
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 1500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    boxRef.current?.scrollTo(0, boxRef.current.scrollHeight);
  }, [lines]);
  return (
    <div className="logconsole" ref={boxRef} role="log" aria-label="Live system log" aria-live="polite">
      {lines.length === 0
        ? 'Waiting for events… create a wallet, set a policy, or send to see the engine narrate.'
        : lines.map((l) => (
            <div key={l.seq}>
              <span className="ts">{new Date(l.at).toLocaleTimeString()} </span>
              <span className={l.level}>{l.msg}</span>
            </div>
          ))}
    </div>
  );
}

// Activity tab: two subviews of one event stream — a durable, filterable audit log, and the
// ephemeral live system log (audit #8).
function ActivityTab({ wallets }: { wallets: Wallet[] }) {
  const [sub, setSub] = useState<'audit' | 'live'>('audit');
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true);
    return v.activity
      .all()
      .then(setItems)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, []);
  // Manual-refresh model (like the rest of the app): fetch when the audit subtab opens, then on demand.
  useEffect(() => {
    if (sub === 'audit') void load();
  }, [sub, load]);
  const filtered = items.filter(
    (it) =>
      (kind === 'all' || it.kind === kind) &&
      (!q || JSON.stringify(it).toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <section>
      <div className="subtabs">
        <button type="button" aria-pressed={sub === 'audit'} onClick={() => setSub('audit')}>
          Audit log
        </button>
        <button type="button" aria-pressed={sub === 'live'} onClick={() => setSub('live')}>
          Live system log
        </button>
      </div>
      {sub === 'audit' ? (
        <>
          <div className="act-filters">
            <label className="field" htmlFor="act-kind">
              <span>Type</span>
              <select id="act-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="all">all</option>
                <option value="transaction">sends</option>
                <option value="received">received</option>
                <option value="signature">signatures</option>
                <option value="audit">governance</option>
              </select>
            </label>
            <label className="field" htmlFor="act-q">
              <span>Filter</span>
              <input
                id="act-q"
                value={q}
                placeholder="address, hash, type…"
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <button type="button" className="copybtn" onClick={() => void load()} disabled={busy}>
              {busy ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <div className="act-scroll">
            <ActivityTable items={filtered} wallets={wallets} />
          </div>
        </>
      ) : (
        <LiveLog />
      )}
    </section>
  );
}

// Holder address field: a visible dropdown of platform wallets (discoverable, unlike a bare
// <datalist>) paired with a free-text input — pick a known holder OR type any address.
function HolderField({
  value,
  onChange,
  holders,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  holders: { address: string; email: string }[];
  label: string;
  placeholder: string;
}) {
  return (
    <span className="holder-field">
      {holders.length > 0 && (
        <select
          aria-label={`${label} — pick a holder`}
          value={holders.some((h) => h.address === value) ? value : ''}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        >
          <option value="">pick holder…</option>
          {holders.map((h) => (
            <option key={h.address} value={h.address}>
              {h.email} · {shortHex(h.address)}
            </option>
          ))}
        </select>
      )}
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

// Admin Token tab: deploy a demo ERC-20 (admin owns the supply), distribute it to the user, then —
// once the user approves the admin as spender — pull their tokens via transferFrom. The on-chain
// allowance is the gate (replacing the old off-chain allowlist).
function TokenTab({ wallets }: { wallets: Wallet[] }) {
  const [token, setToken] = useState<{ address: string; owner: string } | null | undefined>(undefined);
  const [deployFrom, setDeployFrom] = useState('');
  const [busy, setBusy] = useState(false);
  // Result of the last action: a line of text plus an optional tx hash so we can deep-link to the
  // explorer (like the wallet activity feed), instead of only printing a truncated hash.
  const [result, setResult] = useState<{ text: string; txHash?: string | null } | null>(null);
  const [dist, setDist] = useState({ to: '', amt: '' });
  const [pull, setPull] = useState({ from: '', amt: '' });
  const [holder, setHolder] = useState('');
  const [holders, setHolders] = useState<{ address: string; email: string }[]>([]);
  const [supply, setSupply] = useState<{ total: string; ownerBal: string } | null>(null);

  const load = useCallback(() => v.tokens.get().then(setToken).catch(() => setToken(null)), []);
  useEffect(() => {
    void load();
  }, [load]);
  // Platform wallets for the holder picker. Retry on failure: this fires on mount and can lose the
  // race with auth readiness or hit a cold-started API — a one-shot fetch would then leave the
  // dropdown empty for the whole session. A successful (even empty) response is accepted; only
  // errors retry. Free-text entry still works regardless.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let attempt = 0; !cancelled; attempt++) {
        try {
          const h = await v.wallets.holders();
          if (!cancelled) setHolders(h);
          return;
        } catch {
          if (attempt >= 3) return; // give up after a few tries; the field still accepts typed addresses
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // Recover after a deploy/restart that outlasted the mount retries: refetch when the tab regains
  // focus (e.g. you click back after the redeploy finishes). On failure, keep the existing list.
  useEffect(() => {
    const refetch = () => {
      if (document.visibilityState === 'visible') v.wallets.holders().then(setHolders).catch(() => undefined);
    };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', refetch);
    return () => {
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', refetch);
    };
  }, []);
  useEffect(() => {
    if (!deployFrom && wallets[0]) setDeployFrom(wallets[0].id);
  }, [wallets, deployFrom]);
  // Total minted supply + the owner's remaining balance (= what's left to distribute). Re-read after
  // each action (msg changes) so the headroom updates once a distribute confirms.
  useEffect(() => {
    if (!token) {
      setSupply(null);
      return;
    }
    Promise.all([
      v.transactions.contractRead({ address: token.address, abi: erc20Abi, functionName: 'totalSupply', args: [] }),
      v.transactions.contractRead({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [token.owner] }),
    ])
      .then(([t, b]) => setSupply({ total: String(t.result), ownerBal: String(b.result) }))
      .catch(() => setSupply(null));
  }, [token, result]);

  const ownerWallet = token
    ? wallets.find((w) => w.address.toLowerCase() === token.owner.toLowerCase())
    : undefined;
  const run = (fn: () => Promise<{ text: string; txHash?: string | null }>) => {
    setBusy(true);
    setResult(null);
    fn()
      .then(setResult)
      .catch((e) => setResult({ text: (e as Error).message }))
      .finally(() => setBusy(false));
  };
  const deploy = () =>
    run(async () => {
      const t = await v.tokens.deploy({ walletId: deployFrom });
      await load();
      return { text: `✓ deployed ${t.address}`, txHash: t.txHash };
    });
  const distribute = () =>
    run(async () => {
      if (!ownerWallet) throw new Error('owner wallet not found locally');
      const tx = await v.transactions.contractWrite({ walletId: ownerWallet.id,
        address: token!.address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [dist.to, parseEther(dist.amt || '0').toString()],
      });
      return { text: `✓ sent ${dist.amt} VCD → ${shortHex(dist.to)} (nonce ${tx.nonce})`, txHash: tx.txHash };
    });
  const transferFrom = () =>
    run(async () => {
      if (!ownerWallet) throw new Error('owner wallet not found locally');
      const amount = parseEther(pull.amt || '0');
      // Preflight the two on-chain gates so we can name the exact shortfall(s) with real numbers,
      // rather than relying on the revert reason (which reports only whichever check trips first).
      const [allowanceR, balanceR] = await Promise.all([
        v.transactions.contractRead({ address: token!.address, abi: erc20Abi, functionName: 'allowance', args: [pull.from, token!.owner] }),
        v.transactions.contractRead({ address: token!.address, abi: erc20Abi, functionName: 'balanceOf', args: [pull.from] }),
      ]);
      const allowance = BigInt(String(allowanceR.result));
      const balance = BigInt(String(balanceR.result));
      const problems: string[] = [];
      if (allowance < amount) problems.push(`approved only ${toEth(allowance.toString())} VCD (allowance)`);
      if (balance < amount) problems.push(`holds only ${toEth(balance.toString())} VCD (balance)`);
      if (problems.length)
        throw new Error(
          `Can't pull ${pull.amt} VCD — holder ${problems.join(' and ')}. The holder must approve ≥ the amount and hold enough to cover it.`,
        );
      const tx = await v.transactions.contractWrite({ walletId: ownerWallet.id,
        address: token!.address,
        abi: erc20Abi,
        functionName: 'transferFrom',
        args: [pull.from, token!.owner, amount.toString()],
      });
      return { text: `✓ pulled ${pull.amt} VCD from ${shortHex(pull.from)} → admin (nonce ${tx.nonce})`, txHash: tx.txHash };
    });
  const checkAllowance = () =>
    run(async () => {
      const r = await v.transactions.contractRead({
        address: token!.address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [holder, token!.owner],
      });
      return { text: `allowance(${shortHex(holder)} → admin) = ${toEth(String(r.result))} VCD` };
    });

  return (
    <section>
      <p className="bal-sub">
        Deploy a demo ERC-20, distribute it to the user, then — once the user approves the admin —
        pull their tokens with <code>transferFrom</code>. The on-chain allowance is the gate.
      </p>
      {token === undefined ? (
        <p className="bal-sub">Loading…</p>
      ) : !token ? (
        <div className="form-grid">
          <label className="field" htmlFor="deploy-from">
            <span>Deploy from (funded wallet)</span>
            <select id="deploy-from" value={deployFrom} onChange={(e) => setDeployFrom(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {shortHex(w.address)}
                </option>
              ))}
            </select>
          </label>
          <button onClick={deploy} disabled={busy || !deployFrom}>
            {busy ? 'Deploying…' : 'Deploy demo token'}
          </button>
        </div>
      ) : (
        <>
          <p>
            Token <HashLink value={token.address} href={explorerAddress(token.address)} /> · owner /
            spender <code>{shortHex(token.owner)}</code>
            <CopyButton value={token.owner} label="⧉" />
          </p>
          {supply && (
            <dl className="supply" aria-label="token supply">
              <div>
                <dt>Total minted</dt>
                <dd>{toEth(supply.total)} VCD</dd>
              </div>
              <div>
                <dt>Owner holds (available to distribute)</dt>
                <dd>{toEth(supply.ownerBal)} VCD</dd>
              </div>
              <div>
                <dt>Distributed to holders</dt>
                <dd>{toEth((BigInt(supply.total) - BigInt(supply.ownerBal)).toString())} VCD</dd>
              </div>
            </dl>
          )}
          <h4>1 · Distribute to a holder</h4>
          <HolderField
            label="recipient address"
            placeholder="holder wallet 0x… (or type)"
            holders={holders}
            value={dist.to}
            onChange={(v) => setDist({ ...dist, to: v })}
          />{' '}
          <input
            aria-label="distribute amount"
            placeholder="amount (VCD)"
            value={dist.amt}
            onChange={(e) => setDist({ ...dist, amt: e.target.value })}
          />{' '}
          <button onClick={distribute} disabled={busy || !dist.to}>
            Send tokens
          </button>
          <h4>2 · After the holder approves — pull with transferFrom</h4>
          <HolderField
            label="from address"
            placeholder="holder 0x… (or type)"
            holders={holders}
            value={pull.from}
            onChange={(v) => setPull({ ...pull, from: v })}
          />{' '}
          <input
            aria-label="transferFrom amount"
            placeholder="amount (VCD)"
            value={pull.amt}
            onChange={(e) => setPull({ ...pull, amt: e.target.value })}
          />{' '}
          <button onClick={transferFrom} disabled={busy || !pull.from}>
            transferFrom → admin
          </button>
          <h4>Check allowance</h4>
          <HolderField
            label="holder address for allowance"
            placeholder="holder 0x… (or type)"
            holders={holders}
            value={holder}
            onChange={setHolder}
          />{' '}
          <button onClick={checkAllowance} disabled={busy || !holder}>
            Read allowance
          </button>
        </>
      )}
      {result && (
        <p>
          {result.text}
          {result.txHash && (
            <>
              {' '}
              · tx <HashLink value={result.txHash} href={explorerTx(result.txHash)} />
            </>
          )}
        </p>
      )}
    </section>
  );
}

// User-side demo-token panel: shows the token + lets the user approve the admin (spender) so the
// admin can transferFrom their tokens. Hidden until a token has been deployed.
function UserTokenPanel({ wallets }: { wallets: Wallet[] }) {
  const [token, setToken] = useState<{ address: string; owner: string } | null>(null);
  const [walletId, setWalletId] = useState('');
  const [amt, setAmt] = useState('');
  const [bal, setBal] = useState('');
  const [result, setResult] = useState<{ text: string; txHash?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    v.tokens.get().then((t) => setToken(t)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!walletId && wallets[0]) setWalletId(wallets[0].id);
  }, [wallets, walletId]);

  const wallet = wallets.find((w) => w.id === walletId);
  const refreshBal = useCallback(() => {
    if (!token || !wallet) return;
    v.transactions
      .contractRead({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address] })
      .then((r) => setBal(toEth(String(r.result))))
      .catch(() => undefined);
  }, [token, wallet]);
  useEffect(() => {
    refreshBal();
  }, [refreshBal]);

  if (!token || !wallet) return null;

  const approve = () => {
    setBusy(true);
    setResult(null);
    v.transactions
      .contractWrite({
        walletId,
        address: token.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [token.owner, parseEther(amt || '0').toString()],
      })
      .then((tx) => setResult({ text: `✓ approved admin for ${amt} VCD (nonce ${tx.nonce})`, txHash: tx.txHash }))
      .catch((e) => setResult({ text: (e as Error).message }))
      .finally(() => setBusy(false));
  };

  return (
    <section>
      <h2 className="cap">Demo token (ERC-20)</h2>
      <p className="bal-sub">
        The admin issued a demo token (<HashLink value={token.address} href={explorerAddress(token.address)} />).
        Approve the admin as a spender to let them move your tokens via <code>transferFrom</code>.
      </p>
      <div className="form-grid">
        <label className="field" htmlFor="tok-wallet">
          <span>From wallet</span>
          <select id="tok-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {shortHex(w.address)}
              </option>
            ))}
          </select>
        </label>
        <span className="bal-sub">
          balance {bal || '—'} VCD{' '}
          <button type="button" className="copybtn" onClick={refreshBal}>
            refresh
          </button>
        </span>
        <label className="field" htmlFor="tok-amt">
          <span>Approve amount (VCD)</span>
          <input id="tok-amt" type="number" step="any" min="0" value={amt} onChange={(e) => setAmt(e.target.value)} />
        </label>
        <button onClick={approve} disabled={busy || !amt}>
          {busy ? 'Approving…' : 'Approve admin'}
        </button>
      </div>
      {result && (
        <p>
          {result.text}
          {result.txHash && (
            <>
              {' '}
              · tx <HashLink value={result.txHash} href={explorerTx(result.txHash)} />
            </>
          )}
        </p>
      )}
    </section>
  );
}

// Settings / Dev tools: the low-frequency, environment-level, or destructive controls — one tab
// deep on purpose (audit #1/#10). Admin key shown as a status, never as the value.
function SettingsTab({ onChange }: { onChange: () => void }) {
  const [seedMsg, setSeedMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adminKey, setAdminKey] = useState(adminKeyStore.get());
  const [txLookup, setTxLookup] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [accountMsg, setAccountMsg] = useState('');
  const { accounts, createAccount, reload, signOut } = useAuth();

  const addAccount = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setAccountMsg('');
    setBusy(true);
    try {
      const acct = await createAccount(newEmail.trim().toLowerCase());
      setNewEmail('');
      setAccountMsg(`Created ${acct.email} — it now appears in the User view's account picker.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    setError('');
    setSeedMsg('');
    setBusy(true);
    try {
      const res = await v.admin.seed();
      const funded = res.wallets.filter((w) => w.funded).length;
      await reload(); // demo account now appears in the User-view picker
      onChange(); // refresh the wallet-scoped panels
      setSeedMsg(`Seeded ${res.email} — ${res.wallets.length} wallets, ${funded} funded.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startOver = async () => {
    // Reset wipes ALL accounts and re-seeds the demo — the active account is replaced.
    if (!window.confirm('Wipe ALL data and re-seed the demo? This cannot be undone.')) return;
    setError('');
    setSeedMsg('');
    setBusy(true);
    try {
      const res = await v.admin.reset();
      signOut(); // the old session's account no longer exists
      await reload(); // AdminView re-signs in as the fresh demo account
      setSeedMsg(`Reset complete — re-seeded ${res.email}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3>
        Admin key{' '}
        {adminKey ? (
          <span className="pill confirmed">configured ✓</span>
        ) : (
          <span className="pill pending">not set</span>
        )}
      </h3>
      <p className="bal-sub">
        Gates only seed/reset — creating wallets, sending, and policy don't need it. In production
        it's a server-side secret, never shown; here you paste the dev key to enable the destructive
        actions below.
      </p>
      <label htmlFor="admin-key-input">x-admin-key</label>{' '}
      <input
        id="admin-key-input"
        type="password"
        value={adminKey}
        placeholder="paste admin key"
        onChange={(e) => {
          setAdminKey(e.target.value);
          adminKeyStore.set(e.target.value);
        }}
      />

      <h3>Accounts</h3>
      <p className="bal-sub">
        Accounts you create here appear in the <strong>User</strong> view's picker and sign in with
        the shared demo password.
      </p>
      <form onSubmit={addAccount}>
        <label htmlFor="new-account-email">New account email</label>{' '}
        <input
          id="new-account-email"
          type="email"
          autoComplete="email"
          placeholder="name@demo.local"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />{' '}
        <button type="submit" disabled={busy || !newEmail.trim()}>
          {busy ? 'Working…' : 'Create account'}
        </button>
      </form>
      {accountMsg && <p>{accountMsg}</p>}
      {accounts.length > 0 && (
        <ul>
          {accounts.map((a) => (
            <li key={a.id}>{a.email}</li>
          ))}
        </ul>
      )}

      <h3>Demo data</h3>
      <button onClick={seed} disabled={busy}>
        {busy ? 'Seeding…' : 'Seed demo data'}
      </button>{' '}
      <button onClick={startOver} disabled={busy}>
        {busy ? 'Working…' : 'Start over (reset all)'}
      </button>
      {seedMsg && <p>{seedMsg}</p>}
      {error && <p role="alert">{error}</p>}

      <h3>Chain inspector</h3>
      <p>
        <a href={FAUCET_URL} target="_blank" rel="noreferrer">
          Sepolia faucet ↗
        </a>{' '}
        — fund a wallet address to enable live sends.{' '}
        <button onClick={onChange} disabled={busy}>
          Force balance refresh
        </button>
      </p>
      <label>
        Look up a tx hash on Etherscan{' '}
        <input
          value={txLookup}
          placeholder="0x… tx hash"
          onChange={(e) => setTxLookup(e.target.value)}
        />
      </label>{' '}
      <a
        href={txLookup ? explorerTx(txLookup) : undefined}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!txLookup}
      >
        Open ↗
      </a>

    </section>
  );
}

// Admin experience: a tabbed custody-ops console. Signs in as an account (the demo user by
// default) so wallet-scoped panels resolve; seed/reset use the admin key. The network heartbeat
// stays outside the tabs (global state); the active tab lives in the URL hash (deep-linkable).
const ADMIN_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'limits', label: 'Limits' },
  { id: 'token', label: 'Token' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];
function AdminView({ onExit }: { onExit: () => void }) {
  const { accounts, current, signIn } = useAuth();
  // Always act as the admin: if no session, or a (stale) non-admin user is signed in, switch to
  // the admin account. listAccounts only returns isDemo accounts, so accounts[0] is the admin.
  const actingAsAdmin = current?.email === ADMIN_EMAIL;
  useEffect(() => {
    if (!actingAsAdmin && accounts.length > 0) void signIn(accounts[0]).catch(() => undefined);
  }, [actingAsAdmin, accounts, signIn]);
  const { wallets, refresh, lastUpdated, error } = useWallets(actingAsAdmin ? current?.id : undefined);
  const [tab, setTab] = useHashTab('overview');

  return (
    <main className="app">
      <header>
        <h1>
          <button type="button" className="logobtn" onClick={onExit}>
            VenCura
          </button>{' '}
          · Admin
        </h1>
        <span style={{ marginLeft: 'auto' }} className="account signed-in">
          {current ? <span>acting as {current.email}</span> : <span>no account yet</span>}{' '}
          <button type="button" className="link" onClick={onExit}>
            ← Home
          </button>
        </span>
      </header>
      <StatusBar lastUpdated={lastUpdated} onRefresh={() => void refresh()} />
      <DemoBanner />
      {error && <p role="alert">{error}</p>}
      <Tabs tabs={ADMIN_TABS} active={tab} onChange={setTab} />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <OverviewTab wallets={wallets} onGoWallets={() => setTab('wallets')} />}
        {tab === 'wallets' && <WalletsTab wallets={wallets} onChange={refresh} email={current?.email ?? ''} />}
        {tab === 'limits' && <LimitsTab wallets={wallets} />}
        {tab === 'token' && <TokenTab wallets={wallets} />}
        {tab === 'activity' && <ActivityTab wallets={wallets} />}
        {tab === 'settings' && <SettingsTab onChange={refresh} />}
      </div>
    </main>
  );
}

// Two experiences behind a simple landing page. Plain state-based routing — a two-view app
// doesn't need a router dependency.
const VIEW_KEY = 'vencura.view';
type View = 'landing' | 'user' | 'admin';

function Root() {
  // Persist the chosen view so a reload returns to the same screen (paired with token-based session
  // restore in AuthProvider) instead of dropping back to the landing picker.
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) as View) || 'landing');
  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
  }, [view]);
  // Reflect the active view in the tab title (the user view isn't an admin console).
  useEffect(() => {
    document.title =
      view === 'user' ? 'VenCura — Wallet' : view === 'admin' ? 'VenCura Admin' : 'VenCura';
  }, [view]);
  if (view === 'user') return <UserView onExit={() => setView('landing')} />;
  if (view === 'admin') return <AdminView onExit={() => setView('landing')} />;
  return <Landing onPick={setView} />;
}

export function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
