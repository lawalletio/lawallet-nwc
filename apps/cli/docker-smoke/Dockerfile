FROM docker:29-dind

RUN apk add --no-cache \
    bash \
    curl \
    git \
    nodejs \
    npm

RUN npm install --global pnpm@10.11.0

WORKDIR /workspace

COPY . /opt/lawallet-nwc-snapshot
COPY apps/cli/docker-smoke/entrypoint.sh /usr/local/bin/lawallet-docker-smoke-entrypoint
COPY apps/cli/docker-smoke/run-smoke-test.sh /usr/local/bin/lawallet-docker-smoke

RUN chmod +x \
    /usr/local/bin/lawallet-docker-smoke-entrypoint \
    /usr/local/bin/lawallet-docker-smoke

ENV DOCKER_TLS_CERTDIR=""
ENV LAWALLET_SMOKE_SOURCE_SNAPSHOT=/opt/lawallet-nwc-snapshot
ENV LAWALLET_SMOKE_SOURCE_REPO=/workspace/lawallet-nwc
ENV LAWALLET_SMOKE_INSTALL_ROOT=/workspace/install
ENV LAWALLET_SMOKE_APP_PORT=2288
ENV LAWALLET_SMOKE_DOCS_PORT=3000
ENV LAWALLET_SMOKE_OPENAPI_PORT=4500
ENV LAWALLET_SMOKE_POSTGRES_PORT=55432

ENTRYPOINT ["/usr/local/bin/lawallet-docker-smoke-entrypoint"]
CMD ["/usr/local/bin/lawallet-docker-smoke"]
