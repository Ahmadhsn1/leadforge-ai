import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import * as path from 'node:path';

/**
 * E2E config.
 *
 * Vitest's default esbuild transform does not emit decorator metadata, which
 * Nest's DI depends on. SWC does, so it handles transformation here.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    globals: true,
    // E2E tests hit a real database and run the full pipeline.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Shared database: parallel files would race on the same rows.
    fileParallelism: false,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
