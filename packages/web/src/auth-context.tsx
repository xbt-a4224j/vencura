import { createContext, type ReactNode, useContext, useState } from 'react';
import { api, tokenStore } from './api';

interface AuthCtx {
  email: string | null;
  authenticate: (mode: 'login' | 'register', email: string, password: string) => Promise<void>;
  logout: () => void;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const authenticate = async (mode: 'login' | 'register', e: string, p: string) => {
    const res = await api[mode](e, p);
    tokenStore.set(res.accessToken);
    setEmail(res.user.email);
  };
  const logout = () => {
    tokenStore.clear();
    setEmail(null);
  };
  return <Ctx.Provider value={{ email, authenticate, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
};
