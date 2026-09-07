import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The Prisma CLI runs from this package, but DATABASE_URL lives in the
// monorepo root .env alongside every other service's configuration.
loadDotenv({ path: path.join(__dirname, '..', '..', '.env') });

export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(__dirname, 'prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
