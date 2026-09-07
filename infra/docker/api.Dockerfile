# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# LeadForge API
# Multi-stage: the runtime image carries production dependencies and compiled
# output only — no source, no toolchain, no dev dependencies.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat openssl
WORKDIR /app

# --- deps: install the full workspace so builds can run -------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY packages/ai/package.json ./packages/ai/
COPY apps/api/package.json ./apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @leadforge/api...

# --- build ----------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @leadforge/database generate \
 && pnpm --filter @leadforge/config build \
 && pnpm --filter @leadforge/shared build \
 && pnpm --filter @leadforge/database build \
 && pnpm --filter @leadforge/ai build \
 && pnpm --filter @leadforge/api build

# --- runtime --------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/.npmrc ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api

# Prune to production dependencies, then regenerate the Prisma client so the
# engine matches this image's platform.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @leadforge/api... \
 && pnpm --filter @leadforge/database exec prisma generate \
 && pnpm store prune

# Run unprivileged.
USER node

EXPOSE 4000
ENV API_PORT=4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
