import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS DI reads constructor parameter types from decorator metadata. Vitest's
// default esbuild transform drops that metadata, so we transform with SWC and
// explicitly enable legacy decorators + metadata — matching what tsc emits for
// the production build. Without this, type-based injection fails only in tests.
export default defineConfig({
  resolve: {
    // Mirror the tsconfig `@/*` → src/* alias so tests under test/ import source cleanly.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.{test,spec}.ts'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    coverage: { include: ['src/**'] }, // coverage maps to source, not the tests
  },
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
