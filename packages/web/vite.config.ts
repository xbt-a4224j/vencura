import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Proxy /api → Nest (port 3000) so the SPA and API share an origin in dev
// (no CORS config needed; the bearer token rides on same-origin requests).
export default defineConfig({
  resolve: {
    // Mirror the tsconfig `@/*` → src/* alias so tests under test/ import source cleanly.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
