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
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json

# Install dependencies for web app and its workspace deps
RUN pnpm install --frozen-lockfile --filter=@lawallet-nwc/web...

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy web app source
COPY apps/web ./apps/web

# Copy workspace packages (for any shared imports)
COPY packages ./packages

# Generate Prisma client and build
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

WORKDIR /app/apps/web
RUN pnpm exec prisma generate && pnpm run build

# Production image
FROM base AS runner
WORKDIR /app

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
RUN npm install -g prisma

# Set permissions
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 2288

ENV NODE_ENV=production

WORKDIR /app/apps/web
CMD ["sh", "-c", "prisma migrate deploy && node ../../server.js"]
