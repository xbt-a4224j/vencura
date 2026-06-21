import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { type Account, DEMO_PASSWORD, tokenStore, v } from './vencura';

// Remember the last-used account so a reload restores the session without a prompt.
const LAST_KEY = 'vencura.accountId';

type AuthResultLike = { accessToken: string; user: Account };

interface AuthCtx {
  accounts: Account[]; // every account — the User-view picker + the Admin list
  current: Account | null; // the signed-in account
  signIn: (account: Account) => Promise<void>; // Admin one-click login with the shared demo password
  signOut: () => void;
  createAccount: (email: string) => Promise<Account>; // Admin: register with the shared password
  reload: () => Promise<Account[]>; // refetch the account list (e.g. after seed/reset)
  // User side: real credentials (the single self-registered account chooses its own password).
  loginUser: (email: string, password: string) => Promise<void>;
  registerUser: (email: string, password: string) => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

// No typed login: the deployment is gated by Vercel Authentication. The User view lists accounts
// and signs in with the shared demo password (prepopulated); the Admin view creates accounts
// (which then appear in that list). Both go through the real /auth/login + /auth/register.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [current, setCurrent] = useState<Account | null>(null);

  const reload = useCallback(async () => {
    const list = await v.auth.accounts();
    setAccounts(list);
    return list;
  }, []);

  const signIn = useCallback(async (account: Account) => {
    const res = await v.auth.login({ email: account.email, password: DEMO_PASSWORD });
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
      // Admin-gated demo-account creation (shared password + isDemo) so it shows in the picker.
      const account = await v.admin.createAccount({ email });
      await reload();
      return account;
    },
    [reload],
  );

  // User side: the single self-registered account, with its own chosen password.
  const enter = (res: AuthResultLike) => {
    tokenStore.set(res.accessToken);
    localStorage.setItem(LAST_KEY, res.user.id);
    setCurrent(res.user);
  };
  const loginUser = useCallback(async (email: string, password: string) => {
    enter(await v.auth.login({ email, password }));
  }, []);
  const registerUser = useCallback(async (email: string, password: string) => {
    enter(await v.auth.register({ email, password }));
  }, []);

  // On load: fetch the account list, then restore the session straight from the persisted token
  // (survives reloads until the JWT expires, ~1d). This works for ANY account — including the real
  // self-registered user, who isn't in the demo account list. A stale/expired token is cleared.
  useEffect(() => {
    void (async () => {
      await reload();
      if (!tokenStore.get()) return;
      try {
        setCurrent(await v.auth.me());
      } catch {
        tokenStore.clear(); // expired/invalid — drop it so we don't send a dead bearer
        localStorage.removeItem(LAST_KEY);
      }
    })();
  }, [reload]);

  return (
    <Ctx.Provider
      value={{ accounts, current, signIn, signOut, createAccount, reload, loginUser, registerUser }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
};
