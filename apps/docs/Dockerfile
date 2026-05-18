FROM node:22-trixie-slim

RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm

WORKDIR /app

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV CI=1

RUN pnpm install --frozen-lockfile --filter=@lawallet-nwc/docs... \
    && pnpm --filter @lawallet-nwc/docs build

WORKDIR /app/apps/docs

EXPOSE 3000

CMD ["pnpm", "start"]
