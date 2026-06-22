# Base image with Node.js 22 on Debian Trixie Slim
FROM node:22-trixie-slim AS base

# Install system dependencies and pnpm in one layer
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy workspace manifests for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web/prisma ./apps/web/prisma
COPY packages/openapi/package.json ./packages/openapi/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json

# Install dependencies for web app and its workspace deps
RUN pnpm install --frozen-lockfile --filter=@lawallet-nwc/web...

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/openapi/node_modules ./packages/openapi/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy web app source
COPY apps/web ./apps/web

# Copy workspace packages (for any shared imports)
COPY packages ./packages

# Generate Prisma client and build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV CI=1
# Build-time-only placeholders. `next build` imports route modules that
# instantiate PrismaClient at import time (lib/prisma.ts) and run strict env
# validation (lib/config/env.ts), so DATABASE_URL must be a valid Postgres URL
# and JWT_SECRET >= 32 chars or the build fails with "Environment variable not
# found: DATABASE_URL". The build never connects to the DB (mirrors CI), and
# these live only in this discarded builder stage — the runtime image takes the
# real values at `docker run`. (SKIP_ENV_VALIDATION is not read anywhere in the
# codebase, so it cannot bypass validation.)
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV JWT_SECRET=docker-build-only-placeholder-secret-not-used-at-runtime

WORKDIR /app/apps/web
RUN pnpm exec prisma generate && pnpm run build

# Production image
FROM base AS runner
WORKDIR /app
ARG PRISMA_VERSION=6.19.2

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copy standalone output from builder
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/prisma ./apps/web/prisma
COPY --from=builder /app/apps/web/lib/generated ./apps/web/lib/generated

# Install Prisma CLI for migrations
ENV NODE_PATH=/usr/local/lib/node_modules
RUN npm install -g "prisma@${PRISMA_VERSION}" \
    && mkdir -p /app/apps/web/node_modules \
    && ln -s /usr/local/lib/node_modules/prisma /app/apps/web/node_modules/prisma

# Set permissions
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app

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
