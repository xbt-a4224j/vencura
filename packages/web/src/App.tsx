import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { erc20Abi, parseEther } from 'viem';
import {
  type ActivityItem,
  adminKeyStore,
  api,
  type BalanceLine,
  type Policy,
  type Wallet,
} from './api';
import { AuthProvider, useAuth } from './auth-context';
import { explorerAddress, explorerTx, FAUCET_URL } from './explorer';

// Compact sign-in / register, shown as a corner dropdown — never a full-page gate.
function SignInMenu() {
  const { authenticate } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await authenticate(mode, email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="account">
      <summary>Sign in / Register</summary>
      <form onSubmit={submit} className="account-form">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="password">Password (8+ characters)</label>
        <input
          id="password"
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'register' ? 'Create account' : 'Log in'}
        </button>
        <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Need an account? Register' : 'Already have an account? Log in'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}

// Corner account control: signed in → email + switch-user; signed out → the sign-in dropdown.
function AccountMenu() {
  const { email, logout } = useAuth();
  if (!email) return <SignInMenu />;
  return (
    <span className="account signed-in">
      <span>{email}</span>{' '}
      <button onClick={logout} title="Sign out / switch to another account">
        Switch user
      </button>
    </span>
  );
}

// Landing body when signed out — the app is reachable; the gate is gone.
function Welcome() {
  return (
    <section>
      <h3>Welcome to VenCura</h3>
      <p>
        Custodial Ethereum wallets on Sepolia. <strong>Sign in or create an account</strong> from the menu in
        the top-right — then create a wallet, check its balance, sign a message, and send ETH or ERC-20 tokens.
      </p>
    </section>
  );
}

const CUSTOM = '__custom__';

/** Send native ETH or an ERC-20, with asset + recipient dropdowns and ETH-decimal amount entry. */
function SendForm({
  wallet,
  assets,
  recipients,
  onSent,
}: {
  wallet: Wallet;
  assets: { value: string; label: string }[];
  recipients: { value: string; label: string }[];
  onSent: () => void;
}) {
  const [asset, setAsset] = useState('ETH');
  const [recipient, setRecipient] = useState(recipients[0]?.value ?? CUSTOM);
  const [custom, setCustom] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const to = recipient === CUSTOM ? custom.trim() : recipient;
      if (!to) throw new Error('recipient is required');
      // Amount is entered in ETH decimals; convert to wei base units before POST (ERC-20s
      // here are demo-only and also use 18 decimals, so parseEther is fine for the demo).
      const wei = parseEther(amount).toString();
      await api.send(wallet.id, { to, asset, amount: wei });
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
      <label htmlFor={`asset-${wallet.id}`}>Asset</label>
      <select id={`asset-${wallet.id}`} value={asset} onChange={(e) => setAsset(e.target.value)}>
        {assets.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>

      <label htmlFor={`to-${wallet.id}`}>Recipient</label>
      <select id={`to-${wallet.id}`} value={recipient} onChange={(e) => setRecipient(e.target.value)}>
        {recipients.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
        <option value={CUSTOM}>custom address…</option>
      </select>
      {recipient === CUSTOM && (
        <input
          aria-label="custom recipient address"
          placeholder="0x…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      )}

      <label htmlFor={`amount-${wallet.id}`}>Amount (ETH)</label>
      <input
        id={`amount-${wallet.id}`}
        type="number"
        step="any"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button type="submit" disabled={busy || amount.length === 0}>
        {busy ? 'Sending…' : 'Send'}
      </button>
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

  if (items.length === 0) return <p>No activity yet.</p>;
  return (
    <ul>
      {items.map((it) =>
        it.kind === 'transaction' ? (
          <li key={it.id}>
            <span className={`pill ${it.status}`}>{it.status}</span> · sent {it.amount}{' '}
            {it.asset === 'ETH' ? 'wei' : 'units'} →{' '}
            <a href={explorerAddress(it.to)} target="_blank" rel="noreferrer">
              <code>{it.to}</code>
            </a>
            {it.txHash && (
              <>
                {' '}
                · tx{' '}
                <a href={explorerTx(it.txHash)} target="_blank" rel="noreferrer">
                  <code>{it.txHash}</code>
                </a>
              </>
            )}
          </li>
        ) : (
          <li key={it.id}>
            <span className="pill signed">signed</span> · “{it.message}” →{' '}
            <code>{it.signature.slice(0, 20)}…</code>
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
function ConcurrencyDemo({ wallet, recipient }: { wallet: Wallet; recipient?: string }) {
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
      {!recipient ? (
        <p>Needs a recipient — add one to the policy allowlist or create another wallet.</p>
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
          {nonces.length > 0 && (
            <p>
              nonces: <code>{sorted.join(', ')}</code> ·{' '}
              <strong>{unique && monotonic ? '✓ unique + consecutive' : '✗ collision!'}</strong>
            </p>
          )}
          {errors.length > 0 && <p role="alert">{errors.length} failed: {errors[0].error}</p>}
        </>
      )}
    </details>
  );
}

function WalletItem({ wallet, otherWallets }: { wallet: Wallet; otherWallets: Wallet[] }) {
  const [balances, setBalances] = useState<BalanceLine[] | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');
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
    return guard(async () => setSignature((await api.signMessage(wallet.id, message)).signature));
  };

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
    ...otherWallets.map((w) => ({ value: w.address, label: `wallet ${w.address.slice(0, 10)}…` })),
    ...(policy?.allowlist ?? [])
      .filter((a) => !otherWallets.some((w) => w.address.toLowerCase() === a.toLowerCase()))
      .map((a) => ({ value: a, label: `allowlist ${a.slice(0, 10)}…` })),
  ];

  return (
    <li>
      <code>{wallet.address}</code>
      <div>
        <button onClick={() => load()} disabled={busy}>
          Refresh balances
        </button>
        {balances && (
          <ul>
            {balances.map((b) => (
              <li key={b.asset}>
                {b.symbol}: available <strong>{b.available}</strong> (confirmed {b.confirmed}, block{' '}
                {b.asOfBlock ?? '—'})
              </li>
            ))}
          </ul>
        )}
      </div>

      <h4>Send</h4>
      <SendForm
        wallet={wallet}
        assets={assetOptions}
        recipients={recipientOptions}
        onSent={onSent}
      />

      <ConcurrencyDemo wallet={wallet} recipient={recipientOptions[0]?.value} />
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
              signature: <code>{signature}</code>
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
  const create = async () => {
    setError('');
    try {
      await api.createWallet();
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
        setPerTxLimit(p.perTxLimit ?? '');
        setDailyLimit(p.dailyLimit ?? '');
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
        perTxLimit: perTxLimit.trim() || null,
        dailyLimit: dailyLimit.trim() || null,
      });
      setStatus('saved');
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
      <label htmlFor={`pertx-${wallet.id}`}>Per-tx limit (wei; blank = none)</label>
      <input
        id={`pertx-${wallet.id}`}
        value={perTxLimit}
        onChange={(e) => setPerTxLimit(e.target.value)}
      />
      <label htmlFor={`daily-${wallet.id}`}>Daily limit (wei; blank = none)</label>
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
  const { logout } = useAuth();

  const seed = async () => {
    setError('');
    setSeedMsg('');
    setBusy(true);
    try {
      const res = await api.seedDemo();
      const funded = res.wallets.filter((w) => w.funded).length;
      setSeedMsg(
        `Seeded ${res.email} (password: ${res.password}) — ${res.wallets.length} wallets, ${funded} funded. Log in as the demo user to drive them.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startOver = async () => {
    // Reset wipes ALL users, including the one we're logged in as — confirm, then log out.
    if (!window.confirm('Wipe ALL data and re-seed the demo? This cannot be undone.')) return;
    setError('');
    setSeedMsg('');
    setBusy(true);
    try {
      const res = await api.resetDemo();
      logout();
      window.alert(`Reset complete. Log in as ${res.email} / ${res.password}.`);
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
        x-admin-key (gates seed/reset — get it from the deploy env; locally{' '}
        <code>dev-admin-key</code>)
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
            <a href={explorerAddress(w.address)} target="_blank" rel="noreferrer">
              <code>{w.address}</code>
            </a>
          </li>
        ))}
      </ul>
      <button onClick={onChange}>Refresh wallets</button>
    </section>
  );
}

// The app shell ALWAYS renders — no login gate. Signed in → wallets/admin tabs;
// signed out → a welcome body. Auth lives in the corner AccountMenu.
function Shell() {
  const { email } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [tab, setTab] = useState<'wallets' | 'admin'>('wallets');
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    if (!email) {
      setWallets([]);
      return Promise.resolve();
    }
    setError('');
    return api
      .listWallets()
      .then(setWallets)
      .catch((err) => setError((err as Error).message));
  }, [email]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="app">
      <header>
        <h1>VenCura</h1>
        <span style={{ marginLeft: 'auto' }}>
          <AccountMenu />
        </span>
      </header>
      {email ? (
        <>
          <nav className="tabs">
            <button onClick={() => setTab('wallets')} disabled={tab === 'wallets'}>
              Wallets
            </button>
            <button onClick={() => setTab('admin')} disabled={tab === 'admin'}>
              Admin
            </button>
          </nav>
          {error && <p role="alert">{error}</p>}
          {tab === 'wallets' ? (
            <WalletsTab wallets={wallets} onChange={refresh} />
          ) : (
            <AdminTab wallets={wallets} onChange={refresh} />
          )}
        </>
      ) : (
        <Welcome />
      )}
    </main>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
