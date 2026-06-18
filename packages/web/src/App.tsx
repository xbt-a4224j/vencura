import { type FormEvent, useState } from 'react';
import { api, type BalanceLine, type Wallet } from './api';
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
    </main>
  );
}

function WalletItem({ wallet }: { wallet: Wallet }) {
  const [balances, setBalances] = useState<BalanceLine[] | null>(null);
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  const viewBalances = () => guard(async () => setBalances((await api.getBalance(wallet.id)).balances));
  const sign = (e: FormEvent) => {
    e.preventDefault();
    return guard(async () => setSignature((await api.signMessage(wallet.id, message)).signature));
  };

  return (
    <li>
      <code>{wallet.address}</code>
      <div>
        <button onClick={viewBalances} disabled={busy}>
          View balances
        </button>
        {balances && (
          <ul>
            {balances.map((b) => (
              <li key={b.asset}>
                {b.symbol}: {b.available} (confirmed {b.confirmed}, block {b.asOfBlock ?? '—'})
              </li>
            ))}
          </ul>
        )}
      </div>
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
      {error && <p role="alert">{error}</p>}
    </li>
  );
}

function Dashboard() {
  const { email, logout } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const refresh = () =>
    run(async () => {
      setWallets(await api.listWallets());
      setLoaded(true);
    });
  const create = () =>
    run(async () => {
      await api.createWallet();
      await refresh();
    });

  return (
    <main>
      <header>
        <span>{email}</span> <button onClick={logout}>logout</button>
      </header>
      <button onClick={create}>Create wallet</button>
      <button onClick={refresh}>Refresh</button>
      {error && <p role="alert">{error}</p>}
      {loaded && wallets.length === 0 ? (
        <p>No wallets yet — create one.</p>
      ) : (
        <ul>
          {wallets.map((w) => (
            <WalletItem key={w.id} wallet={w} />
          ))}
        </ul>
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
