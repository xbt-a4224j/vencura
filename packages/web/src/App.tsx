import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { parseEther } from 'viem';
import {
  adminKeyStore,
  api,
  type BalanceLine,
  type Policy,
  type Transaction,
  type Wallet,
} from './api';
import { AuthProvider, useAuth } from './auth-context';

function AuthForm() {
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
    <main>
      <h1>VenCura Admin</h1>
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Working…' : mode}
        </button>
        <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          switch to {mode === 'login' ? 'register' : 'login'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      <p>
        New here? Use the <strong>Seed demo data</strong> button after registering — or seed first,
        then log in as <code>demo@vencura.local</code> / <code>demo-password</code>.
      </p>
    </main>
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
function TxList({ wallet, refreshKey }: { wallet: Wallet; refreshKey: number }) {
  const [txs, setTxs] = useState<Transaction[]>([]);

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .listTransactions(wallet.id)
        .then((rows) => active && setTxs(rows))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 4000); // poll pending → confirmed/failed
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [wallet.id, refreshKey]);

  if (txs.length === 0) return <p>No transactions yet.</p>;
  return (
    <ul>
      {txs.map((t) => (
        <li key={t.id}>
          <strong>{t.status}</strong> · {t.amount} {t.asset === 'ETH' ? 'wei' : 'units'} →{' '}
          <code>{t.toAddress}</code>
          {t.txHash && (
            <>
              {' '}
              · tx <code>{t.txHash}</code>
            </>
          )}
        </li>
      ))}
    </ul>
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

      <h4>Transactions</h4>
      <TxList wallet={wallet} refreshKey={refreshKey} />

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
      </button>
      {seedMsg && <p>{seedMsg}</p>}
      {error && <p role="alert">{error}</p>}

      <h3>Policies</h3>
      {wallets.length === 0 ? (
        <p>No wallets — create or seed first.</p>
      ) : (
        wallets.map((w) => <PolicyEditor key={w.id} wallet={w} />)
      )}

      <h3>Wallet addresses</h3>
      <ul>
        {wallets.map((w) => (
          <li key={w.id}>
            <code>{w.address}</code>
          </li>
        ))}
      </ul>
      <button onClick={onChange}>Refresh wallets</button>
    </section>
  );
}

function Dashboard() {
  const { email, logout } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [tab, setTab] = useState<'wallets' | 'admin'>('wallets');
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    setError('');
    return api
      .listWallets()
      .then(setWallets)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main>
      <header>
        <span>{email}</span> <button onClick={logout}>logout</button>
      </header>
      <nav>
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
    </main>
  );
}

function Shell() {
  const { email } = useAuth();
  return email ? <Dashboard /> : <AuthForm />;
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
