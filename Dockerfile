# 1. Builder stage
FROM node:20-alpine AS builder

# 2. Set working directory
WORKDIR /app

# 3. Install pnpm
RUN npm install -g pnpm

# 4. Copy package and lock files
# Copy package files and prisma directory first
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

# 5. Install dependencies
# Install dependencies (postinstall will now work)
RUN pnpm install --frozen-lockfile

# 6. Copy the rest of the code
# Copy the rest of the code
COPY . .

# 7. Generate Prisma client and run migrations
# Build the app
RUN pnpm build

# 8. Build the Next.js app

# 2. Production stage
FROM node:20-alpine AS production

# 2. Set working directory
WORKDIR /app

# 3. Install pnpm
RUN npm install -g pnpm

# 4. Copy only the necessary files from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/.env ./.env

# 9. Expose the port Next.js runs on
EXPOSE 3000

# 10. Start the app
CMD ["pnpm", "start"] 