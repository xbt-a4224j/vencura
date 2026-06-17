import { type FormEvent, useState } from 'react';
import { api, type Wallet } from './api';
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
            <li key={w.id}>
              <code>{w.address}</code>
            </li>
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
