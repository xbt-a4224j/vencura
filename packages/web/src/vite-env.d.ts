/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional site-wide password gate (deploy-only). */
  readonly VITE_SITE_USERNAME?: string;
  readonly VITE_SITE_PASSWORD?: string;
  /** Optional: seed the Admin console x-admin-key into the gated deploy build. */
  readonly VITE_ADMIN_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
