import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.spec.ts'], globals: true },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
