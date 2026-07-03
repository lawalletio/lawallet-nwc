# syntax=docker/dockerfile:1

# ── Build base: Node.js 22 (Debian Trixie Slim) + pnpm via corepack ────
FROM node:22-trixie-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# ── deps: full install (dev deps needed for the tsup build) ────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/listener/package.json ./apps/listener/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter=@lawallet-nwc/listener...

# ── proddeps: production-only node_modules for the runtime image ───────
FROM base AS proddeps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/listener/package.json ./apps/listener/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile --prod --filter=@lawallet-nwc/listener...

# ── builder: bundle src (+ @lawallet-nwc/shared, which ships raw TS) ────
FROM base AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/listener/node_modules ./apps/listener/node_modules
COPY apps/listener ./apps/listener
COPY packages/shared ./packages/shared
RUN pnpm --filter=@lawallet-nwc/listener build

# ── runner: minimal runtime (node + prod deps + dist bundle) ───────────
FROM node:22-trixie-slim AS runner
WORKDIR /app

# curl: the docker-compose healthcheck curls /health from inside the container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 listener

COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=proddeps /app/apps/listener/node_modules ./apps/listener/node_modules
# The workspace symlink target for @lawallet-nwc/shared (unused at runtime —
# the bundle inlines it — but keeps the node_modules tree link-complete).
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/listener/dist ./apps/listener/dist
COPY --from=builder /app/apps/listener/package.json ./apps/listener/package.json
RUN chown -R listener:nodejs /app

USER listener
ENV NODE_ENV=production
EXPOSE 4100

WORKDIR /app/apps/listener
CMD ["node", "dist/index.js"]
