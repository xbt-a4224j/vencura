import { Vencura } from '@vencura/sdk';
import { adminKeyStore, tokenStore } from './api';

// The single SDK client the whole app drives. Same-origin: the SPA is served alongside the API
// behind a `/api` rewrite, so basePath is '/api'. It reuses the app's localStorage token store (so
// a session survives reloads) and reads the operator admin key at call time. The admin UI dogfoods
// the same `@vencura/sdk` a customer would use — every screen goes through it.
export const v = new Vencura({
  basePath: '/api',
  tokenStore,
  adminKey: () => adminKeyStore.get(),
});
