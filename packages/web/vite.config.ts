import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Proxy /api → Nest (port 3000) so the SPA and API share an origin in dev
// (no CORS config needed; the bearer token rides on same-origin requests).
export default defineConfig({
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
