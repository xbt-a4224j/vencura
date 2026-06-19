import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

interface PollingCtx {
  live: boolean;
  setLive: (v: boolean) => Promise<void>;
  ready: boolean;
}

const Ctx = createContext<PollingCtx>({ live: false, setLive: async () => undefined, ready: false });

export function PollingProvider({ children }: { children: ReactNode }) {
  const [live, setLiveState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.getPolling()
      .then((r) => setLiveState(r.live))
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const setLive = async (v: boolean) => {
    await api.setPolling(v);
    setLiveState(v);
  };

  return <Ctx.Provider value={{ live, setLive, ready }}>{children}</Ctx.Provider>;
}

export function usePolling() {
  return useContext(Ctx);
}
