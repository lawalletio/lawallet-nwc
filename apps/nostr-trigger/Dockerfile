# syntax=docker/dockerfile:1
# ==============================================================================
# @lawallet-nwc/nostr-trigger — multi-stage Bun build
# ==============================================================================

# --- Stage 1: install deps ----------------------------------------------------
FROM oven/bun:1-slim AS deps
WORKDIR /app

# pnpm is used for workspace resolution; Bun runs the service at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && bun install --global pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/nostr-trigger/package.json ./apps/nostr-trigger/
COPY packages/prisma/package.json ./packages/prisma/

RUN pnpm install --frozen-lockfile --filter=@lawallet-nwc/nostr-trigger...

# --- Stage 2: build -----------------------------------------------------------
FROM deps AS builder
WORKDIR /app

COPY packages/prisma ./packages/prisma
COPY apps/nostr-trigger ./apps/nostr-trigger

# Generate the shared Prisma client, then produce a Bun bundle.
RUN pnpm --filter @lawallet-nwc/prisma run build \
 && pnpm --filter @lawallet-nwc/nostr-trigger run build

# --- Stage 3: runtime ---------------------------------------------------------
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# non-root user
RUN groupadd --system --gid 1001 bun \
 && useradd --system --uid 1001 --gid bun bun

COPY --from=builder --chown=bun:bun /app/apps/nostr-trigger/dist ./dist
COPY --from=builder --chown=bun:bun /app/apps/nostr-trigger/package.json ./package.json
COPY --from=builder --chown=bun:bun /app/packages/prisma ./packages/prisma
COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules

USER bun

EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3010/health || exit 1

CMD ["bun", "dist/index.js"]
