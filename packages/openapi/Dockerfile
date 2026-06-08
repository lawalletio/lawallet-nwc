FROM node:22-trixie-slim

RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm

WORKDIR /app

COPY . .

ENV NODE_ENV=production
ENV CI=1

RUN pnpm install --frozen-lockfile --filter=@lawallet-nwc/openapi...

WORKDIR /app/packages/openapi

EXPOSE 4500

CMD ["pnpm", "start"]
