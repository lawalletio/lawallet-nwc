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

# Copy package files and prisma schema for better caching
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

# Install all dependencies (including dev dependencies for build)
RUN pnpm install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Generate Prisma client and build in one layer
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm exec prisma generate && pnpm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

# Create non-root user for security in one layer
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copy the standalone output from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/lib/generated ./lib/generated

# Install only Prisma CLI for migrations
RUN npm install -g prisma

# Create database directory and set proper permissions in one layer
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 8888

# Set environment variables
ENV NODE_ENV=production

# Run database migrations and start the application
CMD ["sh", "-c", "prisma migrate deploy && node server.js"]
