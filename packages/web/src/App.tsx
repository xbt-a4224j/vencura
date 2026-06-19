import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { erc20Abi, isAddress, parseEther, recoverMessageAddress } from 'viem';
import {
  type ActivityItem,
  adminKeyStore,
  api,
  type BalanceLine,
  DEMO_PASSWORD,
  type LogLine,
  type Person,
  type Policy,
  type Wallet,
} from './api';
import { AuthProvider, useAuth } from './auth-context';
import { explorerAddress, explorerTx, FAUCET_URL } from './explorer';
import { nicknames, shortHex, toEth, walletLabel } from './format';

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

// Polls the chain head for the status-bar heartbeat (block height + gas), no auth.
function useChainHead() {
  const [head, setHead] = useState<{ blockNumber: number; gasGwei: number } | null>(null);
  useEffect(() => {
    let active = true;
    const tick = () =>
      api
        .chainHead()
        .then((h) => active && setHead(h))
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 6000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);
  return head;
}

// Shared status bar: network + live block/gas heartbeat, the time that block reading was
// fetched ("updated"), and a right-aligned wall clock — together they assure the user the
// block number is current (it updates, and "now" keeps ticking past it). lastUpdated/onRefresh
// stay optional for callers that still want a manual refresh control.
function StatusBar({ onRefresh }: { lastUpdated?: string; onRefresh?: () => void }) {
  const head = useChainHead();
  const [headAt, setHeadAt] = useState('');
  const [now, setNow] = useState(() => new Date().toLocaleTimeString());
  // Stamp the fetch time whenever a fresh head arrives.
  useEffect(() => {
    if (head) setHeadAt(new Date().toLocaleTimeString());
  }, [head]);
  // Tick the wall clock every second so "now" visibly advances.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);
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
      {onRefresh && (
        <button type="button" className="copybtn" onClick={onRefresh}>
          Refresh
        </button>
      )}
      <span className="clock" style={{ marginLeft: 'auto' }} title="current time">
        {now}
      </span>
    </div>
  );
}

// Loads the signed-in account's wallets (re-fetches whenever the session changes).
function useWallets(enabled: boolean) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const refresh = useCallback(() => {
    if (!enabled) {
      setWallets([]);
      return Promise.resolve();
    }
    setError('');
    return api
      .listWallets()
      .then((w) => {
        setWallets(w);
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .catch((err) => setError((err as Error).message));
  }, [enabled]);
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
        <p className="tagline">the Venmo of wallets</p>
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

// User experience: pick an account (password prepopulated → one click), then drive your wallets.
function UserView({ onExit }: { onExit: () => void }) {
  const { accounts, current, signIn, signOut } = useAuth();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    const acct = accounts.find((a) => a.id === (selected || accounts[0]?.id));
    if (!acct) return;
    setError('');
    setBusy(true);
    try {
      await signIn(acct);
    } catch (err) {
      const m = (err as Error).message;
      // The shared demo password only works for demo accounts; real/test registrations 401.
      setError(
        /invalid email or password/i.test(m)
          ? `${m} — this account uses its own password. Pick the demo account (top of the list).`
          : m,
      );
    } finally {
      setBusy(false);
    }
  };

  if (!current) {
    return (
      <main className="app">
        <header>
          <h1>VenCura · User</h1>
          <button type="button" className="link" style={{ marginLeft: 'auto' }} onClick={onExit}>
            ← Home
          </button>
        </header>
        <DemoBanner />
        <section className="picker">
          <h3>Choose an account</h3>
          {accounts.length === 0 ? (
            <p>
              No accounts yet — open the <strong>Admin</strong> view to seed demo data or create one.
            </p>
          ) : (
            <>
              <label htmlFor="user-account">Account</label>{' '}
              <select
                id="user-account"
                value={selected || accounts[0]?.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
              <p className="bal-sub">
                Password is prepopulated (<code>{DEMO_PASSWORD}</code>) — just continue.
              </p>
              <button type="button" onClick={enter} disabled={busy}>
                {busy ? 'Signing in…' : 'Continue'}
              </button>
              {error && <p role="alert">{error}</p>}
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <header>
        <h1>VenCura</h1>
        <span style={{ marginLeft: 'auto' }} className="account signed-in">
          <span>{current.email}</span>{' '}
          <button type="button" onClick={signOut} title="Switch to another account">
            Switch account
          </button>{' '}
          <button type="button" className="link" onClick={onExit}>
            ← Home
          </button>
        </span>
      </header>
      <StatusBar />
      <Venmo />
    </main>
  );
}

// Auto-refreshing native-ETH available balance for one wallet. Polls every BLOCK_MS so the
// "updated" stamp ticks on its own — no manual Refresh button (CLAUDE.md §8 demoability).
const BLOCK_MS = 12_000; // Sepolia block time
function usePolledBalance(walletId: string | undefined) {
  const [line, setLine] = useState<BalanceLine | null>(null);
  const [updated, setUpdated] = useState('');
  useEffect(() => {
    if (!walletId) return;
    let active = true;
    const tick = () =>
      api
        .getBalance(walletId)
        .then((b) => {
          if (!active) return;
          setLine(b.balances.find((l) => l.asset === 'ETH') ?? null);
          setUpdated(new Date().toLocaleTimeString());
        })
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, BLOCK_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [walletId]);
  return { line, updated };
}

// The Venmo user experience: one wallet (provisioned + funded on sign-in), a big balance,
// a people-picker Send card, and an activity feed. The engineering surfaces live in Admin.
function Venmo() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const { line, updated } = usePolledBalance(wallet?.id);

  // One wallet per account: provision (create + master-fund) it on entry; idempotent server-side.
  useEffect(() => {
    let active = true;
    api
      .provisionWallet()
      .then((w) => active && setWallet(w))
      .catch((e) => active && setError((e as Error).message));
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p role="alert">{error}</p>;
  if (!wallet) return <p className="bal-sub">Setting up your wallet…</p>;

  const onSent = () => setRefreshKey((k) => k + 1);

  return (
    <section>
      <div className="bal-grid">
        <div className="bal-line">
          <span className="bal-label">Available balance</span>
          <span className="bal-hero" title={line ? `${line.available} wei` : undefined}>
            {line ? toEth(line.available) : '—'}
            <span className="unit">ETH</span>
          </span>
          <span className="bal-sub">
            <a href={explorerAddress(wallet.address)} target="_blank" rel="noreferrer" title={wallet.address}>
              <code>{shortHex(wallet.address)}</code> ↗
            </a>
            <CopyButton value={wallet.address} label="⧉" />
            {updated && ` · updated ${updated}`}
          </span>
        </div>
      </div>
      {line && BigInt(line.available) === 0n && (
        <p className="hint">
          Your wallet is empty — fund it from the{' '}
          <a href={FAUCET_URL} target="_blank" rel="noreferrer">
            Sepolia faucet ↗
          </a>
          <CopyButton value={wallet.address} label="copy address" />
        </p>
      )}

      <h2 className="cap">Pay someone</h2>
      <VenmoSend wallet={wallet} onSent={onSent} />

      <h2 className="cap">Activity</h2>
      <ActivityFeed wallet={wallet} refreshKey={refreshKey} />

      <ContractPanel wallet={wallet} />
    </section>
  );
}

// Venmo-style send: pick a person (annotated allowed ✓ / blocked + inline Allow), enter ETH.
// "Allow" appends them to this wallet's policy allowlist (setPolicy) so the send can proceed.
function VenmoSend({ wallet, onSent }: { wallet: Wallet; onSent: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [recipient, setRecipient] = useState(CUSTOM);
  const [custom, setCustom] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Two-step send: validate → review panel → confirm. `alsoAllow` makes allowlisting a deliberate,
  // separate choice instead of a side effect of Pay (audit #7).
  const [confirm, setConfirm] = useState<{ to: string; wei: bigint } | null>(null);
  const [alsoAllow, setAlsoAllow] = useState(false);

  const loadPolicy = useCallback(
    () => api.getPolicy(wallet.id).then(setPolicy).catch(() => undefined),
    [wallet.id],
  );
  useEffect(() => {
    api.listPeople().then(setPeople).catch(() => undefined);
    void loadPolicy();
  }, [loadPolicy]);

  const allow = (policy?.allowlist ?? []).map((a) => a.toLowerCase());
  const to = recipient === CUSTOM ? custom.trim() : recipient;
  const isAllowed = (addr: string) => allow.length === 0 || allow.includes(addr.toLowerCase());

  // Append `addr` to the wallet's allowlist (preserving limits), then refresh the local policy.
  const allowAddress = async (addr: string) => {
    setError('');
    try {
      const next = Array.from(new Set([...(policy?.allowlist ?? []), addr]));
      await api.setPolicy(wallet.id, {
        allowlist: next,
        perTxLimit: policy?.perTxLimit ?? null,
        dailyLimit: policy?.dailyLimit ?? null,
      });
      await loadPolicy();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Step 1: validate and open the review panel (no funds move yet).
  const review = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (!to) throw new Error('Pick a recipient.');
      if (!isAddress(to)) throw new Error('Enter a valid 0x address.');
      let wei: bigint;
      try {
        wei = parseEther(amount);
      } catch {
        throw new Error('Enter a valid amount.');
      }
      if (wei <= 0n) throw new Error('Amount must be greater than 0.');
      setAlsoAllow(false);
      setConfirm({ to, wei });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Step 2: confirm. Allowlisting only happens if the user explicitly opted in (alsoAllow).
  const confirmPay = async () => {
    if (!confirm) return;
    setError('');
    setBusy(true);
    try {
      if (!isAllowed(confirm.to) && alsoAllow) await allowAddress(confirm.to);
      await api.send(wallet.id, { to: confirm.to, asset: 'ETH', amount: confirm.wei.toString() });
      setAmount('');
      setConfirm(null);
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={review}>
      <div className="form-grid">
        <label className="field" htmlFor={`pay-${wallet.id}`}>
          <span>To</span>
          <select id={`pay-${wallet.id}`} value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            <optgroup label="People">
              {people.map((p) => (
                <option key={p.accountId} value={p.address}>
                  {isAllowed(p.address) ? '✓ ' : '🔒 '}
                  {p.email}
                </option>
              ))}
            </optgroup>
            <optgroup label="Custom">
              <option value={CUSTOM}>custom address…</option>
            </optgroup>
          </select>
        </label>

        {recipient === CUSTOM && (
          <label className="field">
            <span>Custom address</span>
            <input
              aria-label="custom recipient address"
              placeholder="0x…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </label>
        )}

        <label className="field" htmlFor={`amt-${wallet.id}`}>
          <span>Amount (ETH)</span>
          <input
            id={`amt-${wallet.id}`}
            type="number"
            step="any"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <button type="submit" disabled={amount.length === 0 || !!confirm}>
          Review payment
        </button>
      </div>
      {to && isAddress(to) && !isAllowed(to) && !confirm && (
        <p className="hint">
          🔒 {shortHex(to)} isn't on your allowlist yet —{' '}
          <button type="button" className="copybtn" onClick={() => void allowAddress(to)}>
            Allow
          </button>{' '}
          to enable paying them.
        </p>
      )}
      {confirm && (
        <div className="hint" role="group" aria-label="Confirm payment">
          <div>
            Send <strong>{toEth(confirm.wei.toString())} ETH</strong> to{' '}
            <code>{shortHex(confirm.to)}</code>?
          </div>
          {!isAllowed(confirm.to) && (
            <label style={{ display: 'flex', flexDirection: 'row', gap: 6, textTransform: 'none' }}>
              <input type="checkbox" checked={alsoAllow} onChange={(e) => setAlsoAllow(e.target.checked)} />
              Also add this recipient to the allowlist
            </label>
          )}
          {!isAllowed(confirm.to) && !alsoAllow && (
            <p className="preflight bad" style={{ margin: '4px 0 0' }}>
              ✗ not on the allowlist — the send will be blocked by policy unless you allow them
            </p>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button type="button" onClick={confirmPay} disabled={busy}>
              {busy ? 'Sending…' : 'Confirm & pay'}
            </button>
            <button type="button" className="copybtn" onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

const CUSTOM = '__custom__';

/** Send native ETH or an ERC-20, with asset + recipient dropdowns and ETH-decimal amount entry. */
function SendForm({
  wallet,
  assets,
  recipients,
  policy,
  onSent,
}: {
  wallet: Wallet;
  assets: { value: string; label: string }[];
  recipients: { value: string; label: string; group?: string }[];
  policy: Policy | null;
  onSent: () => void;
}) {
  const [asset, setAsset] = useState('ETH');
  const [recipient, setRecipient] = useState(recipients[0]?.value ?? CUSTOM);
  const [custom, setCustom] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const to = recipient === CUSTOM ? custom.trim() : recipient;
  // Client mirror of the server policy (allowlist + per-tx) for a live pre-flight verdict.
  // The daily limit is server-enforced (needs today's spend), so it isn't previewed here.
  const preflight = (() => {
    if (!policy || !to || !isAddress(to)) return null;
    const allow = policy.allowlist.map((a) => a.toLowerCase());
    if (allow.length > 0 && !allow.includes(to.toLowerCase()))
      return { ok: false, msg: 'recipient not on allowlist' };
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
      if (!to) throw new Error('Recipient is required.');
      if (!isAddress(to)) throw new Error('Enter a valid 0x address.');
      // Amount is entered in ETH decimals; convert to wei base units before POST (ERC-20s
      // here are demo-only and also use 18 decimals, so parseEther is fine for the demo).
      let wei: bigint;
      try {
        wei = parseEther(amount);
      } catch {
        throw new Error('Enter a valid amount.');
      }
      if (wei <= 0n) throw new Error('Amount must be greater than 0.');
      await api.send(wallet.id, { to, asset, amount: wei.toString() });
      setAmount('');
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
          <span>Recipient</span>
          <select id={`to-${wallet.id}`} value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            {Object.entries(
              recipients.reduce<Record<string, { value: string; label: string }[]>>((acc, r) => {
                (acc[r.group ?? 'Recipients'] ??= []).push(r);
                return acc;
              }, {}),
            ).map(([group, opts]) => (
              <optgroup key={group} label={group}>
                {opts.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label="Custom">
              <option value={CUSTOM}>custom address…</option>
            </optgroup>
          </select>
        </label>

        {recipient === CUSTOM && (
          <label className="field">
            <span>Custom address</span>
            <input
              aria-label="custom recipient address"
              placeholder="0x…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </label>
        )}

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

        <button type="submit" disabled={busy || amount.length === 0}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {preflight && (
        <p className={`preflight ${preflight.ok ? 'ok' : 'bad'}`}>
          {preflight.ok ? '✓ ' : '✗ '}
          {preflight.ok ? 'within policy' : `would be blocked: ${preflight.msg}`}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

/** Polls the wallet's recent transactions and shows status + hash. */
// Unified on/off-chain history: on-chain sends + off-chain signatures, newest-first.
function ActivityFeed({ wallet, refreshKey }: { wallet: Wallet; refreshKey: number }) {
  const [items, setItems] = useState<ActivityItem[]>([]);

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .listActivity(wallet.id)
        .then((rows) => active && setItems(rows))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 4000); // poll pending → confirmed/failed
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [wallet.id, refreshKey]);

  if (items.length === 0)
    return (
      <p className="bal-sub">No transactions or signatures yet — sign a message or send to get started.</p>
    );
  return (
    <ul>
      {items.map((it) => {
        if (it.kind === 'transaction')
          return (
            <li key={it.id}>
              <span className={`pill ${it.status}`}>{it.status}</span> · sent{' '}
              <strong>{toEth(it.amount)}</strong> {it.asset === 'ETH' ? 'ETH' : 'tokens'} →{' '}
              <HashLink value={it.to} href={explorerAddress(it.to)} />
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
              <span className="pill signed">signed</span> · “{it.message}” →{' '}
              <code>{shortHex(it.signature)}</code>
              <CopyButton value={it.signature} label="⧉" />
            </li>
          );
        // audit: a durable governance event (policy.changed, wallet.created, admin.*)
        return (
          <li key={it.id}>
            <span className="pill audit">{it.type}</span>
          </li>
        );
      })}
    </ul>
  );
}

// #30: move ETH to another of your own wallets (checking → savings). Reuses the send path.
function TransferForm({
  wallet,
  otherWallets,
  onSent,
}: {
  wallet: Wallet;
  otherWallets: Wallet[];
  onSent: () => void;
}) {
  const [toWalletId, setToWalletId] = useState(otherWallets[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (otherWallets.length === 0) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const tx = await api.transfer(wallet.id, {
        toWalletId,
        asset: 'ETH',
        amount: parseEther(amount || '0').toString(),
      });
      setMsg(`✓ transfer sent (nonce ${tx.nonce})`);
      onSent();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details>
      <summary>Internal transfer (to your other wallets)</summary>
      <form onSubmit={submit}>
        <label>
          To wallet
          <select value={toWalletId} onChange={(e) => setToWalletId(e.target.value)}>
            {otherWallets.map((w) => (
              <option key={w.id} value={w.id}>
                {walletLabel(w.id, w.address)}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Amount (ETH)
          <input
            aria-label="internal transfer amount in ETH"
            value={amount}
            placeholder="0.01"
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>{' '}
        <button disabled={busy}>{busy ? 'Sending…' : 'Transfer'}</button>
        {msg && <p>{msg}</p>}
      </form>
    </details>
  );
}

// #32: generic contract read/write, with a friendly ERC-20 front door + a raw "advanced" panel.
function ContractPanel({ wallet }: { wallet: Wallet }) {
  const [token, setToken] = useState('');
  const [info, setInfo] = useState('');
  const [spender, setSpender] = useState('');
  const [approveAmt, setApproveAmt] = useState('');
  const [apMsg, setApMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const readErc20 = (functionName: string, args: unknown[] = []) =>
    api.contractRead({ address: token, abi: erc20Abi, functionName, args }).then((r) => r.result);

  const inspect = async () => {
    setBusy(true);
    setInfo('');
    try {
      const [name, symbol, decimals, bal] = await Promise.all([
        readErc20('name'),
        readErc20('symbol'),
        readErc20('decimals'),
        readErc20('balanceOf', [wallet.address]),
      ]);
      setInfo(`${name} (${symbol}) · decimals ${decimals} · your balance ${bal}`);
    } catch (e) {
      setInfo((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setApMsg('');
    try {
      const tx = await api.contractWrite(wallet.id, {
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, parseEther(approveAmt || '0').toString()],
      });
      setApMsg(`✓ approve sent (nonce ${tx.nonce}) — once it confirms, click "Check allowance"`);
    } catch (e) {
      setApMsg((e as Error).message);
    }
  };

  // The proof an approve worked: read allowance(owner, spender) back from the token.
  const checkAllowance = async () => {
    try {
      const allowance = await readErc20('allowance', [wallet.address, spender]);
      setApMsg(`allowance(this wallet → ${spender.slice(0, 8)}…) = ${allowance}`);
    } catch (e) {
      setApMsg((e as Error).message);
    }
  };

  return (
    <details>
      <summary>Contracts (ERC-20)</summary>
      <label>
        Token address
        <input
          aria-label="ERC-20 token contract address"
          value={token}
          placeholder="0x… ERC-20 contract"
          onChange={(e) => setToken(e.target.value)}
        />
      </label>{' '}
      <button onClick={inspect} disabled={busy || !token}>
        {busy ? 'Reading…' : 'Inspect token'}
      </button>
      {info && <p>{info}</p>}

      <h4>Approve a spender</h4>
      <input
        aria-label="spender address"
        value={spender}
        placeholder="spender 0x…"
        onChange={(e) => setSpender(e.target.value)}
      />{' '}
      <input
        aria-label="approve amount in token units"
        value={approveAmt}
        placeholder="amount (ETH units)"
        onChange={(e) => setApproveAmt(e.target.value)}
      />{' '}
      <button onClick={approve} disabled={!token || !spender}>
        Approve
      </button>{' '}
      <button onClick={checkAllowance} disabled={!token || !spender}>
        Check allowance
      </button>
      {apMsg && <p>{apMsg}</p>}

      <RawContractCall wallet={wallet} />
    </details>
  );
}

// The fully-generic capability (any ABI / function / args) — power-user surface.
function RawContractCall({ wallet }: { wallet: Wallet }) {
  const [address, setAddress] = useState('');
  const [abi, setAbi] = useState('');
  const [fn, setFn] = useState('');
  const [args, setArgs] = useState('[]');
  const [out, setOut] = useState('');

  const run = async (write: boolean) => {
    setOut('');
    try {
      const parsedAbi = JSON.parse(abi);
      const parsedArgs = JSON.parse(args || '[]');
      if (write) {
        const tx = await api.contractWrite(wallet.id, { address, abi: parsedAbi, functionName: fn, args: parsedArgs });
        setOut(`✓ write sent (nonce ${tx.nonce})`);
      } else {
        const r = await api.contractRead({ address, abi: parsedAbi, functionName: fn, args: parsedArgs });
        setOut(`result: ${JSON.stringify(r.result)}`);
      }
    } catch (e) {
      setOut((e as Error).message);
    }
  };

  return (
    <details>
      <summary>Developer tools — raw contract call (any ABI)</summary>
      <p className="hint">
        ⚠ Power-user surface: sends an arbitrary contract call from this custodial wallet. Use the
        curated Send / Approve controls above for normal operations.
      </p>
      <input
        aria-label="raw call contract address"
        value={address}
        placeholder="contract 0x…"
        onChange={(e) => setAddress(e.target.value)}
      />
      <textarea
        aria-label="raw call ABI JSON"
        value={abi}
        placeholder='ABI JSON, e.g. [{"type":"function",...}]'
        onChange={(e) => setAbi(e.target.value)}
      />
      <input
        aria-label="raw call function name"
        value={fn}
        placeholder="functionName"
        onChange={(e) => setFn(e.target.value)}
      />{' '}
      <input
        aria-label="raw call arguments JSON"
        value={args}
        placeholder='args JSON, e.g. ["0x..",123]'
        onChange={(e) => setArgs(e.target.value)}
      />{' '}
      <button onClick={() => run(false)} disabled={!address || !fn}>
        Read
      </button>{' '}
      <button onClick={() => run(true)} disabled={!address || !fn}>
        Write
      </button>
      {out && <p>{out}</p>}
    </details>
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
  // Dry-run: render the serialized nonce timeline the lock WOULD assign, without spending — so the
  // payoff is visible even on an unfunded wallet (audit #11). Relative (n, n+1, …) since the live
  // starting nonce isn't known client-side.
  const [sim, setSim] = useState(false);
  const simulate = () => {
    setSim(true);
    setResults(Array.from({ length: n }, (_, i) => ({ nonce: i })));
  };

  const fire = async () => {
    if (!recipient) return;
    setSim(false);
    setBusy(true);
    setResults([]);
    const sends = Array.from({ length: n }, () =>
      api
        .send(wallet.id, { to: recipient, asset: 'ETH', amount: '1' })
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

  return (
    <details>
      <summary>Concurrency demo (nonce lock)</summary>
      <p className="bal-sub">
        Fires N sends at one wallet at once — proof the per-wallet nonce lock serializes them into
        unique, consecutive nonces (no collisions, no gaps). Simulate it anytime; a funded wallet
        runs it for real on-chain.
      </p>
      <label>
        N concurrent sends{' '}
        <input type="number" min={2} max={20} value={n} onChange={(e) => setN(Number(e.target.value))} />
      </label>{' '}
      <button type="button" className="copybtn" onClick={simulate} disabled={busy}>
        Simulate (dry-run)
      </button>{' '}
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
          {sim && (
            <p className="bal-sub">
              Dry-run — the nonces the lock would assign (relative); no funds moved.
            </p>
          )}
          {[...results]
            .sort((a, b) => (a.nonce ?? Number.MAX_SAFE_INTEGER) - (b.nonce ?? Number.MAX_SAFE_INTEGER))
            .map((r, i) => (
              <div className="nonce-row" key={i}>
                <span className="lock" aria-hidden>
                  🔒
                </span>
                <span className="nnum">
                  {r.nonce != null ? (sim ? `nonce n+${r.nonce}` : `nonce ${r.nonce}`) : '—'}
                </span>
                <span>
                  {r.error ? (
                    <span className="pill failed">failed</span>
                  ) : (
                    <span className="pill pending">{sim ? 'would broadcast' : 'broadcast'}</span>
                  )}
                  {r.error ? ` ${r.error}` : ''}
                </span>
              </div>
            ))}
          <p className={`verdict ${unique && monotonic && errors.length === 0 ? 'ok' : 'bad'}`}>
            {errors.length === 0
              ? `${nonces.length}/${results.length} serialized — unique, consecutive nonces ✓${sim ? ' (simulated)' : ''}`
              : `${errors.length}/${results.length} failed (${errors[0].error})`}
          </p>
        </div>
      )}
    </details>
  );
}

function WalletItem({
  wallet,
  otherWallets,
  highlight,
}: {
  wallet: Wallet;
  otherWallets: Wallet[];
  highlight?: boolean;
}) {
  const [balances, setBalances] = useState<BalanceLine[] | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');
  const [verifyOut, setVerifyOut] = useState('');
  const [nick, setNick] = useState(nicknames.get(wallet.id));
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
        const [bal, pol] = await Promise.all([api.getBalance(wallet.id), api.getPolicy(wallet.id)]);
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
    return guard(async () => setSignature((await api.signMessage(wallet.id, message)).signature));
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
  // Recipient dropdown: the user's other wallets + this wallet's policy allowlist.
  const recipientOptions = [
    ...otherWallets.map((w) => ({ value: w.address, label: walletLabel(w.id, w.address), group: 'Your wallets' })),
    ...(policy?.allowlist ?? [])
      .filter((a) => !otherWallets.some((w) => w.address.toLowerCase() === a.toLowerCase()))
      .map((a) => ({ value: a, label: shortHex(a), group: 'Allowlisted' })),
  ];

  // Native-ETH availability drives the fund hint + gating the concurrency demo (needs gas).
  const ethBal = balances?.find((b) => b.asset === 'ETH');
  const ethAvailable = ethBal ? BigInt(ethBal.available) : 0n;
  const canSend = ethAvailable > 0n;
  const ethZero = !!balances && ethAvailable === 0n;

  return (
    <li className={highlight ? 'flash' : undefined}>
      <div style={{ marginBottom: 8 }}>
        <input
          className="nick"
          aria-label="wallet nickname"
          placeholder="nickname"
          value={nick}
          style={{ width: 150 }}
          onChange={(e) => {
            setNick(e.target.value);
            nicknames.set(wallet.id, e.target.value);
          }}
        />{' '}
        <a href={explorerAddress(wallet.address)} target="_blank" rel="noreferrer" title={wallet.address}>
          <code>{wallet.address}</code> ↗
        </a>
        <CopyButton value={wallet.address} label="⧉" />
      </div>
      {policy && (policy.allowlist.length > 0 || policy.perTxLimit || policy.dailyLimit) && (
        <div className="badges">
          {policy.allowlist.length > 0 && <span className="badge">Allowlist: {policy.allowlist.length}</span>}
          {policy.perTxLimit && <span className="badge">Per-tx ≤ {toEth(policy.perTxLimit)} ETH</span>}
          {policy.dailyLimit && <span className="badge">Daily ≤ {toEth(policy.dailyLimit)} ETH</span>}
        </div>
      )}
      <div>
        <button onClick={() => load()} disabled={busy}>
          Refresh balances
        </button>
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
      <SendForm
        wallet={wallet}
        assets={assetOptions}
        recipients={recipientOptions}
        policy={policy}
        onSent={onSent}
      />

      <ConcurrencyDemo wallet={wallet} recipient={recipientOptions[0]?.value} canSend={canSend} />
      <TransferForm wallet={wallet} otherWallets={otherWallets} onSent={onSent} />
      <ContractPanel wallet={wallet} />

      <h4>Activity (on-chain + signatures)</h4>
      <ActivityFeed wallet={wallet} refreshKey={refreshKey} />

      <details>
        <summary>Sign a message</summary>
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
function WalletsTab({ wallets, onChange }: { wallets: Wallet[]; onChange: () => void }) {
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const create = async () => {
    setError('');
    try {
      const w = await api.createWallet();
      setHighlightId(w.id);
      setOpenId(w.id);
      setTimeout(() => setHighlightId(null), 1800);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={create}>Create wallet</button>
        <button className="copybtn" onClick={onChange}>
          Refresh
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {wallets.length === 0 ? (
        <p>No wallets yet — create one above, or seed demo data in Settings.</p>
      ) : (
        wallets.map((w) => {
          const open = openId === w.id;
          return (
            <div key={w.id} className={highlightId === w.id ? 'flash' : undefined}>
              <button
                type="button"
                className="wrow-head"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : w.id)}
              >
                <span className="nick">{nicknames.get(w.id) || 'Wallet'}</span>
                <code>{shortHex(w.address)}</code>
                <span className="bal-sub">{open ? 'open' : 'manage →'}</span>
                <span className="caret" aria-hidden>
                  {open ? '▾' : '▸'}
                </span>
              </button>
              {open && (
                <div className="wrow-detail">
                  <ul style={{ margin: 0 }}>
                    <WalletItem wallet={w} otherWallets={wallets.filter((o) => o.id !== w.id)} />
                  </ul>
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

/** Edit one wallet's policy as a self-contained card: allowlist (one address per line) + per-tx
 *  and daily limits (entered in ETH). Labels sit directly above their field; save is disabled
 *  until something changes (audit #2). */
function PolicyEditor({ wallet }: { wallet: Wallet }) {
  const [allowlist, setAllowlist] = useState('');
  const [perTxLimit, setPerTxLimit] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [loaded, setLoaded] = useState<Policy | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getPolicy(wallet.id)
      .then((p) => {
        setAllowlist(p.allowlist.join('\n'));
        setPerTxLimit(p.perTxLimit ? toEth(p.perTxLimit) : '');
        setDailyLimit(p.dailyLimit ? toEth(p.dailyLimit) : '');
        setLoaded(p);
      })
      .catch((e) => setError((e as Error).message));
  }, [wallet.id]);

  // Dirty check vs the loaded policy so Save only lights up on a real change.
  const dirty =
    !!loaded &&
    (allowlist !== loaded.allowlist.join('\n') ||
      perTxLimit !== (loaded.perTxLimit ? toEth(loaded.perTxLimit) : '') ||
      dailyLimit !== (loaded.dailyLimit ? toEth(loaded.dailyLimit) : ''));

  const badAddr = allowlist
    .split('\n')
    .map((a) => a.trim())
    .filter(Boolean)
    .some((a) => !isAddress(a));

  const cur = loaded
    ? loaded.allowlist.length === 0 && !loaded.perTxLimit && !loaded.dailyLimit
      ? 'No limits set — any recipient, any amount.'
      : `${loaded.allowlist.length} allowed · per-tx ${loaded.perTxLimit ? `≤ ${toEth(loaded.perTxLimit)} ETH` : '∞'} · daily ${loaded.dailyLimit ? `≤ ${toEth(loaded.dailyLimit)} ETH` : '∞'}`
    : 'Loading…';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setStatus('');
    try {
      const next: Policy = {
        allowlist: allowlist
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
        // Limits are entered in ETH; persist as wei base units to match the backend.
        perTxLimit: perTxLimit.trim() ? parseEther(perTxLimit.trim()).toString() : null,
        dailyLimit: dailyLimit.trim() ? parseEther(dailyLimit.trim()).toString() : null,
      };
      await api.setPolicy(wallet.id, next);
      setLoaded(next);
      setStatus(`✓ saved ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="policy-card" onSubmit={save}>
      <header>
        <span className="nick">{nicknames.get(wallet.id) || 'Wallet'}</span>
        <a href={explorerAddress(wallet.address)} target="_blank" rel="noreferrer" title={wallet.address}>
          <code>{shortHex(wallet.address)}</code> ↗
        </a>
        <CopyButton value={wallet.address} label="⧉" />
      </header>
      <p className="cur">Currently: {cur}</p>
      <div className="policy-grid">
        <label htmlFor={`allow-${wallet.id}`}>
          Allowlist (one address per line — empty = any)
          <textarea
            id={`allow-${wallet.id}`}
            aria-label={`allowlist for ${wallet.address}`}
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
          />
        </label>
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
      </div>
      {badAddr && <p className="preflight bad">✗ allowlist has an invalid 0x address</p>}
      <div className="save-row">
        {status && <span className="bal-sub">{status}</span>}
        <button type="submit" disabled={!dirty || badAddr}>
          Save policy
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

// Unified activity rows as a table (time · wallet · type · detail) — shared by Overview + Activity.
function ActivityTable({ items, wallets }: { items: ActivityItem[]; wallets: Wallet[] }) {
  if (items.length === 0) return <p className="bal-sub">No activity yet.</p>;
  const label = (id?: string | null) => {
    const w = wallets.find((x) => x.id === id);
    return w ? walletLabel(w.id, w.address) : '—';
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
            <td>{new Date(it.createdAt).toLocaleTimeString()}</td>
            <td>{label(it.walletId)}</td>
            <td>
              {it.kind === 'transaction' ? (
                <span className={`pill ${it.status}`}>{it.status}</span>
              ) : it.kind === 'signature' ? (
                <span className="pill signed">signed</span>
              ) : (
                <span className="pill audit">{it.type}</span>
              )}
            </td>
            <td>
              {it.kind === 'transaction' && (
                <>
                  sent <strong>{toEth(it.amount)}</strong> →{' '}
                  <HashLink value={it.to} href={explorerAddress(it.to)} />
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
        api
          .getBalance(w.id)
          .then((b) => [w.id, BigInt(b.balances.find((l) => l.asset === 'ETH')?.confirmed ?? '0')] as const)
          .catch(() => [w.id, 0n] as const),
      ),
    ).then((entries) => active && setBals(Object.fromEntries(entries)));
    api.listAllActivity().then((a) => active && setActivity(a)).catch(() => undefined);
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
function PoliciesTab({ wallets }: { wallets: Wallet[] }) {
  if (wallets.length === 0)
    return (
      <section>
        <p>No wallets — create one or seed demo data first.</p>
      </section>
    );
  return (
    <section>
      {wallets.map((w) => (
        <PolicyEditor key={w.id} wallet={w} />
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
      api
        .events(cursor.current)
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
  useEffect(() => {
    if (sub !== 'audit') return;
    let active = true;
    const load = () => api.listAllActivity().then((a) => active && setItems(a)).catch(() => undefined);
    void load();
    const t = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [sub]);
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
          </div>
          <ActivityTable items={filtered} wallets={wallets} />
        </>
      ) : (
        <LiveLog />
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
      const res = await api.seedDemo();
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
      const res = await api.resetDemo();
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
  { id: 'policies', label: 'Policies' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];
function AdminView({ onExit }: { onExit: () => void }) {
  const { accounts, current, signIn } = useAuth();
  useEffect(() => {
    if (!current && accounts.length > 0) void signIn(accounts[0]).catch(() => undefined);
  }, [current, accounts, signIn]);
  const { wallets, refresh, lastUpdated, error } = useWallets(!!current);
  const [tab, setTab] = useHashTab('overview');

  return (
    <main className="app">
      <header>
        <h1>VenCura · Admin</h1>
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
        {tab === 'wallets' && <WalletsTab wallets={wallets} onChange={refresh} />}
        {tab === 'policies' && <PoliciesTab wallets={wallets} />}
        {tab === 'activity' && <ActivityTab wallets={wallets} />}
        {tab === 'settings' && <SettingsTab onChange={refresh} />}
      </div>
    </main>
  );
}

// Two experiences behind a simple landing page. Plain state-based routing — a two-view app
// doesn't need a router dependency.
function Root() {
  const [view, setView] = useState<'landing' | 'user' | 'admin'>('landing');
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
