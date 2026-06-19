import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { erc20Abi, isAddress, parseEther, recoverMessageAddress } from 'viem';
import {
  type ActivityItem,
  adminKeyStore,
  api,
  type BalanceLine,
  DEMO_PASSWORD,
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

// Shared status bar: network, live block/gas heartbeat, last refresh.
function StatusBar({ lastUpdated, onRefresh }: { lastUpdated?: string; onRefresh?: () => void }) {
  const head = useChainHead();
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
      {lastUpdated && <span>updated {lastUpdated}</span>}
      {onRefresh && (
        <button type="button" className="copybtn" onClick={onRefresh}>
          Refresh
        </button>
      )}
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
      setError((err as Error).message);
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
          <span className="bal-amt" title={line ? `${line.available} wei` : undefined}>
            {line ? toEth(line.available) : '—'} ETH
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

      <h4>Pay someone</h4>
      <VenmoSend wallet={wallet} onSent={onSent} />

      <h4>Activity</h4>
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
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
      if (!isAllowed(to)) await allowAddress(to); // auto-allow custom address before sending
      await api.send(wallet.id, { to, asset: 'ETH', amount: wei.toString() });
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

        <button type="submit" disabled={busy || amount.length === 0}>
          {busy ? 'Sending…' : 'Pay'}
        </button>
      </div>
      {to && isAddress(to) && !isAllowed(to) && (
        <p className="hint">
          🔒 {shortHex(to)} isn't on your allowlist yet —{' '}
          <button type="button" className="copybtn" onClick={() => void allowAddress(to)}>
            Allow
          </button>{' '}
          to enable paying them (Pay will also auto-allow).
        </p>
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
      {items.map((it) =>
        it.kind === 'transaction' ? (
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
        ) : (
          <li key={it.id}>
            <span className="pill signed">signed</span> · “{it.message}” →{' '}
            <code>{shortHex(it.signature)}</code>
            <CopyButton value={it.signature} label="⧉" />
          </li>
        ),
      )}
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
                {w.address.slice(0, 12)}…
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Amount (ETH)
          <input value={amount} placeholder="0.01" onChange={(e) => setAmount(e.target.value)} />
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
        <input value={token} placeholder="0x… ERC-20 contract" onChange={(e) => setToken(e.target.value)} />
      </label>{' '}
      <button onClick={inspect} disabled={busy || !token}>
        {busy ? 'Reading…' : 'Inspect token'}
      </button>
      {info && <p>{info}</p>}

      <h4>Approve a spender</h4>
      <input value={spender} placeholder="spender 0x…" onChange={(e) => setSpender(e.target.value)} />{' '}
      <input value={approveAmt} placeholder="amount (ETH units)" onChange={(e) => setApproveAmt(e.target.value)} />{' '}
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
      <summary>Advanced — raw call (any ABI)</summary>
      <input value={address} placeholder="contract 0x…" onChange={(e) => setAddress(e.target.value)} />
      <textarea value={abi} placeholder='ABI JSON, e.g. [{"type":"function",...}]' onChange={(e) => setAbi(e.target.value)} />
      <input value={fn} placeholder="functionName" onChange={(e) => setFn(e.target.value)} />{' '}
      <input value={args} placeholder='args JSON, e.g. ["0x..",123]' onChange={(e) => setArgs(e.target.value)} />{' '}
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

  const fire = async () => {
    if (!recipient) return;
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
        unique, consecutive nonces (no collisions). Needs a funded wallet and a recipient.
      </p>
      {!recipient || !canSend ? (
        <p className="hint">
          {!recipient
            ? 'Add a recipient (another wallet or an allowlist entry) to run this.'
            : 'This wallet is unfunded — fund it (Sepolia faucet) to run the demo.'}
        </p>
      ) : (
        <>
          <label>
            N concurrent sends{' '}
            <input
              type="number"
              min={2}
              max={20}
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
            />
          </label>{' '}
          <button onClick={fire} disabled={busy}>
            {busy ? 'Firing…' : `Fire ${n} concurrent sends`}
          </button>
          {results.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {[...results]
                .sort((a, b) => (a.nonce ?? Number.MAX_SAFE_INTEGER) - (b.nonce ?? Number.MAX_SAFE_INTEGER))
                .map((r, i) => (
                  <div className="nonce-row" key={i}>
                    <span className="lock" aria-hidden>
                      🔒
                    </span>
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
              <p className={`verdict ${unique && monotonic && errors.length === 0 ? 'ok' : 'bad'}`}>
                {errors.length === 0
                  ? `${nonces.length}/${results.length} serialized — unique, consecutive nonces ✓`
                  : `${errors.length}/${results.length} failed (${errors[0].error})`}
              </p>
            </div>
          )}
        </>
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

function WalletsTab({ wallets, onChange }: { wallets: Wallet[]; onChange: () => void }) {
  const [error, setError] = useState('');
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const create = async () => {
    setError('');
    try {
      const w = await api.createWallet();
      setHighlightId(w.id);
      setTimeout(() => setHighlightId(null), 1800);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section>
      <button onClick={create}>Create wallet</button>
      <button onClick={onChange}>Refresh</button>
      {error && <p role="alert">{error}</p>}
      {wallets.length === 0 ? (
        <p>No wallets yet — create one or seed demo data from the Admin tab.</p>
      ) : (
        <ul>
          {wallets.map((w) => (
            <WalletItem
              key={w.id}
              wallet={w}
              otherWallets={wallets.filter((o) => o.id !== w.id)}
              highlight={w.id === highlightId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Edit a wallet's policy: allowlist (one address per line) + per-tx/daily limits (wei). */
function PolicyEditor({ wallet }: { wallet: Wallet }) {
  const [allowlist, setAllowlist] = useState('');
  const [perTxLimit, setPerTxLimit] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getPolicy(wallet.id)
      .then((p) => {
        setAllowlist(p.allowlist.join('\n'));
        setPerTxLimit(p.perTxLimit ? toEth(p.perTxLimit) : '');
        setDailyLimit(p.dailyLimit ? toEth(p.dailyLimit) : '');
      })
      .catch((e) => setError((e as Error).message));
  }, [wallet.id]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setStatus('');
    try {
      await api.setPolicy(wallet.id, {
        allowlist: allowlist
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
        // Limits are entered in ETH; persist as wei base units to match the backend.
        perTxLimit: perTxLimit.trim() ? parseEther(perTxLimit.trim()).toString() : null,
        dailyLimit: dailyLimit.trim() ? parseEther(dailyLimit.trim()).toString() : null,
      });
      setStatus(`✓ saved ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={save}>
      <h4>
        Policy for <code>{wallet.address.slice(0, 12)}…</code>
      </h4>
      <label htmlFor={`allow-${wallet.id}`}>Allowlist (one address per line; empty = any)</label>
      <textarea
        id={`allow-${wallet.id}`}
        value={allowlist}
        onChange={(e) => setAllowlist(e.target.value)}
      />
      <label htmlFor={`pertx-${wallet.id}`}>Per-tx limit (ETH; blank = none)</label>
      <input
        id={`pertx-${wallet.id}`}
        value={perTxLimit}
        onChange={(e) => setPerTxLimit(e.target.value)}
      />
      <label htmlFor={`daily-${wallet.id}`}>Daily limit (ETH; blank = none)</label>
      <input
        id={`daily-${wallet.id}`}
        value={dailyLimit}
        onChange={(e) => setDailyLimit(e.target.value)}
      />
      <button type="submit">Save policy</button>
      {status && <p>{status}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function AdminTab({ wallets, onChange }: { wallets: Wallet[]; onChange: () => void }) {
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
      <h3>Admin key</h3>
      <label>
        x-admin-key — gates only seed/reset (creating wallets, sending, and policy do not need
        it). From the deploy env; locally it is <code>dev-admin-key</code>.
        <input
          type="password"
          value={adminKey}
          placeholder="admin key"
          onChange={(e) => {
            setAdminKey(e.target.value);
            adminKeyStore.set(e.target.value);
          }}
        />
      </label>

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

      <h3>Policies</h3>
      {wallets.length === 0 ? (
        <p>No wallets — create or seed first.</p>
      ) : (
        wallets.map((w) => <PolicyEditor key={w.id} wallet={w} />)
      )}

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

      <h3>Wallet addresses</h3>
      <ul>
        {wallets.map((w) => (
          <li key={w.id}>
            <a href={explorerAddress(w.address)} target="_blank" rel="noreferrer" title={w.address}>
              <code>{w.address}</code> ↗
            </a>
            <CopyButton value={w.address} label="⧉" />
          </li>
        ))}
      </ul>
      <button onClick={onChange}>Refresh wallets</button>
    </section>
  );
}

// Admin experience: account + demo-data management. It signs in as an account (the demo user by
// default) so the wallet-scoped panels (policies, addresses) resolve; seed/reset use the admin key.
function AdminView({ onExit }: { onExit: () => void }) {
  const { accounts, current, signIn } = useAuth();
  // Act as an account so the wallet/policy panels work; default to the first (demo) account.
  useEffect(() => {
    if (!current && accounts.length > 0) void signIn(accounts[0]).catch(() => undefined);
  }, [current, accounts, signIn]);
  const { wallets, refresh, lastUpdated, error } = useWallets(!!current);

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
      {error && <p role="alert">{error}</p>}
      <AdminTab wallets={wallets} onChange={refresh} />
      <h3>Wallets (engineering surfaces)</h3>
      <p className="bal-sub">
        Create wallets, fire concurrent sends (nonce lock), internal transfers, send, sign, and
        inspect — the surfaces that show the engineering. The User view is the Venmo experience.
      </p>
      <WalletsTab wallets={wallets} onChange={refresh} />
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
