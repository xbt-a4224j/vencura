import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { type Account, api, DEMO_PASSWORD, tokenStore } from './api';

// Remember the last-used account so a reload restores the session without a prompt.
const LAST_KEY = 'vencura.accountId';

interface AuthCtx {
  accounts: Account[]; // every account — the User-view picker + the Admin list
  current: Account | null; // the signed-in account
  ready: boolean; // initial account list + session restore finished
  signIn: (account: Account) => Promise<void>; // one-click login with the shared demo password
  signOut: () => void;
  createAccount: (email: string) => Promise<Account>; // Admin: register with the shared password
  reload: () => Promise<Account[]>; // refetch the account list (e.g. after seed/reset)
}
const Ctx = createContext<AuthCtx | null>(null);

// No typed login: the deployment is gated by Vercel Authentication. The User view lists accounts
// and signs in with the shared demo password (prepopulated); the Admin view creates accounts
// (which then appear in that list). Both go through the real /auth/login + /auth/register.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [current, setCurrent] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const list = await api.listAccounts();
    setAccounts(list);
    return list;
  }, []);

  const signIn = useCallback(async (account: Account) => {
    const res = await api.login(account.email, DEMO_PASSWORD);
    tokenStore.set(res.accessToken);
    localStorage.setItem(LAST_KEY, res.user.id);
    setCurrent(res.user);
  }, []);

  const signOut = useCallback(() => {
    tokenStore.clear();
    localStorage.removeItem(LAST_KEY);
    setCurrent(null);
  }, []);

  const createAccount = useCallback(
    async (email: string) => {
      const res = await api.register(email, DEMO_PASSWORD);
      await reload();
      return res.user;
    },
    [reload],
  );

  // On load: fetch the account list and best-effort restore the last-used session (no prompt).
  useEffect(() => {
    void (async () => {
      const list = await reload();
      const last = localStorage.getItem(LAST_KEY);
      const restore = list.find((a) => a.id === last);
      if (restore) await signIn(restore).catch(() => undefined);
    })().finally(() => setReady(true));
  }, [reload, signIn]);

  return (
    <Ctx.Provider value={{ accounts, current, ready, signIn, signOut, createAccount, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
};
