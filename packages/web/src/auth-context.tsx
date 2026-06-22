import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { type Account, tokenStore, v } from './vencura';

// Two persistent identities, each with its own JWT: the system ADMIN (minted, no password — it's a
// system account, not a person) and the single self-registered USER. Switching views switches which
// token the SDK sends — no role special-casing. We persist the user token across reloads; the admin
// session is re-minted on demand (cheap, passwordless).
const USER_TOKEN = 'vencura.userToken';

type Identity = 'user' | 'admin';
type AuthResultLike = { accessToken: string; user: Account };

interface AuthCtx {
  user: Account | null;
  admin: Account | null;
  active: Identity | null;
  current: Account | null; // the active identity's account
  registerUser: (email: string, password: string) => Promise<void>;
  loginUser: (email: string, password: string) => Promise<void>;
  enterAdmin: () => Promise<void>; // mint (if needed) + make admin active
  activateUser: () => void; // make the user the active identity (switch the token)
  signOutUser: () => void;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Account | null>(null);
  const [admin, setAdmin] = useState<Account | null>(null);
  const [active, setActive] = useState<Identity | null>(null);
  // The two JWTs live here (a ref, not state — the SDK reads them via tokenStore, no re-render needed).
  const tokens = useRef<{ user?: string; admin?: string }>({});

  const enterUser = (r: AuthResultLike) => {
    tokens.current.user = r.accessToken;
    localStorage.setItem(USER_TOKEN, r.accessToken);
    tokenStore.set(r.accessToken);
    setUser(r.user);
    setActive('user');
  };
  const registerUser = useCallback(async (email: string, password: string) => {
    enterUser(await v.auth.register({ email, password }));
  }, []);
  const loginUser = useCallback(async (email: string, password: string) => {
    enterUser(await v.auth.login({ email, password }));
  }, []);

  const enterAdmin = useCallback(async () => {
    if (!tokens.current.admin) {
      const r = await v.auth.adminSession();
      tokens.current.admin = r.accessToken;
      setAdmin(r.user);
    } else {
      tokenStore.set(tokens.current.admin);
    }
    setActive('admin');
  }, []);

  const activateUser = useCallback(() => {
    if (tokens.current.user) {
      tokenStore.set(tokens.current.user);
      setActive('user');
    }
  }, []);

  const signOutUser = useCallback(() => {
    tokens.current.user = undefined;
    localStorage.removeItem(USER_TOKEN);
    setUser(null);
    setActive((a) => (a === 'user' ? null : a));
  }, []);

  // Restore the user session from the persisted token on load (survives reloads until the JWT
  // expires). The admin session isn't persisted — it's re-minted when the Admin view is entered.
  useEffect(() => {
    const t = localStorage.getItem(USER_TOKEN);
    if (!t) return;
    tokens.current.user = t;
    tokenStore.set(t);
    v.auth
      .me()
      .then((u) => {
        setUser(u);
        setActive('user');
      })
      .catch(() => {
        tokens.current.user = undefined;
        localStorage.removeItem(USER_TOKEN);
        tokenStore.clear();
      });
  }, []);

  const current = active === 'admin' ? admin : active === 'user' ? user : null;
  return (
    <Ctx.Provider
      value={{ user, admin, active, current, registerUser, loginUser, enterAdmin, activateUser, signOutUser }}
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
