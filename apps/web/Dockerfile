# syntax=docker/dockerfile:1

# ── Build base: Node.js 22 (Debian Trixie Slim) + pnpm via corepack ────
# corepack activates the exact pnpm pinned in package.json's "packageManager"
# field — no floating `npm i -g pnpm@latest` version drift between builds.
FROM node:22-trixie-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# ── deps: install workspace dependencies for the web app ───────────────
FROM base AS deps
WORKDIR /app

# Copy workspace manifests for better layer caching (re-runs only when a
# manifest or the lockfile changes, not on every source edit).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web/prisma ./apps/web/prisma
COPY packages/openapi/package.json ./packages/openapi/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json

RUN pnpm install --frozen-lockfile --filter=@lawallet-nwc/web...

# ── builder: compile the Next.js standalone bundle ─────────────────────
FROM base AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/openapi/node_modules ./packages/openapi/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy web app source + workspace packages (for shared imports)
COPY apps/web ./apps/web
COPY packages ./packages

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV CI=1

WORKDIR /app/apps/web
# Build-time-only placeholders, scoped to this single RUN so they never persist
# as image ENV (Docker's SecretsUsedInArgOrEnv lint) and never reach the
# runtime image. `next build` imports route modules that instantiate
# PrismaClient (lib/prisma.ts) and run strict env validation
# (lib/config/env.ts), so DATABASE_URL must be a valid Postgres URL and
# JWT_SECRET >= 32 chars or the build fails. The build never connects to the DB
# (mirrors CI); the runtime image takes the real values at `docker run`.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    JWT_SECRET=docker-build-only-placeholder-secret-not-used-at-runtime \
    sh -c 'pnpm exec prisma generate && pnpm run build'

# ── runner: minimal runtime image (no pnpm, no build toolchain) ────────
FROM node:22-trixie-slim AS runner
WORKDIR /app
ARG PRISMA_VERSION=6.19.2

# curl: the docker-compose healthcheck curls /api/health from inside the
# container. Create the non-root user in the same layer to keep it lean.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copy standalone output from builder
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/prisma ./apps/web/prisma
COPY --from=builder /app/apps/web/lib/generated ./apps/web/lib/generated

# Prisma CLI for `migrate deploy` at startup (the runtime image carries no
# pnpm). Clean the npm cache in the same layer so it doesn't bloat the image.
ENV NODE_PATH=/usr/local/lib/node_modules
RUN npm install -g "prisma@${PRISMA_VERSION}" \
    && npm cache clean --force \
    && mkdir -p /app/apps/web/node_modules \
    && ln -s /usr/local/lib/node_modules/prisma /app/apps/web/node_modules/prisma \
    && mkdir -p /app/data \
    && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 2288

ENV NODE_ENV=production
# Next.js standalone server.js binds to $HOSTNAME:$PORT. Docker auto-sets
# HOSTNAME to the container id, so without this the server binds only to the
# container's eth0 IP — `localhost`/127.0.0.1 healthchecks fail and a bare
# `docker run -p 2288:2288` can't reach it. Pin both so the image listens on
# all interfaces at the EXPOSEd port out of the box (overridable at runtime).
ENV HOSTNAME=0.0.0.0
ENV PORT=2288

WORKDIR /app/apps/web
CMD ["sh", "-c", "prisma migrate deploy && node server.js"]
