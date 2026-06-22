# Docker

The web app ships as a multi-arch image on Docker Hub:

**https://hub.docker.com/r/masize/lawallet-nwc**

Published for **`linux/amd64`** and **`linux/arm64`**, so it runs natively on
Intel/AMD servers and on ARM (Apple Silicon, AWS Graviton, Raspberry Pi 4/5,
etc.) from the same tag.

| Tag | Meaning |
|-----|---------|
| `masize/lawallet-nwc:latest` | Most recent published build |
| `masize/lawallet-nwc:<version>` | Pinned release, matches `package.json` (e.g. `1.0.0`) |

## Run a published image

The fastest path — no build, no clone. `docker-compose.hub.yml` is
self-contained (published image + Postgres only), so grab that one file and
start:

```bash
curl -O https://raw.githubusercontent.com/lawalletio/lawallet-nwc/main/docker-compose.hub.yml
JWT_SECRET=$(openssl rand -hex 32) docker compose -f docker-compose.hub.yml up -d
```

Override `LAWALLET_TAG`, `PORT`, `JWT_SECRET` (≥ 32 chars), or the `POSTGRES_*`
credentials via env / a `.env` file. Note: the repo's default
`docker-compose.yml` *builds from source* instead — use `docker-compose.hub.yml`
to run the prebuilt image.

Or run the container directly against your own Postgres:

```bash
docker run -d --name lawallet-web -p 2288:2288 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/lawallet" \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  masize/lawallet-nwc:latest
```

The container runs `prisma migrate deploy` on startup, then `node server.js`,
listening on `0.0.0.0:2288`.

## Publish a new multi-arch image

This is the release process for pushing `linux/amd64` + `linux/arm64` to Docker
Hub. It's also automated in CI — see [Automated publishing](#automated-publishing).

### Prerequisites

1. **Docker with Buildx** (bundled with Docker Desktop ≥ 19.03 and modern Docker
   Engine). Confirm:

   ```bash
   docker buildx version
   ```

2. **A `docker-container` builder.** The *default* builder uses the `docker`
   driver, which **cannot emit a multi-platform image** — it can only build for
   the host architecture. Multi-arch requires the `docker-container` driver.
   Create one once (Docker Desktop already ships a `xbuilder` you can reuse):

   ```bash
   # Create + select a multi-platform builder (idempotent: ignore "existing")
   docker buildx create --name multiarch --driver docker-container --use --bootstrap
   docker buildx ls   # the builder should list linux/amd64 AND linux/arm64
   ```

   On Apple Silicon / single-arch hosts, Buildx emulates the foreign
   architecture via QEMU (`binfmt_misc`). Docker Desktop bundles this; on a bare
   Linux host install it once with
   `docker run --privileged --rm tonistiigi/binfmt --install all`.

3. **Authenticated to Docker Hub** as a user with push access to the `masize`
   namespace:

   ```bash
   docker login                 # or: docker login -u masize
   ```

### Build and push

Run from the **repo root** (the build context is the monorepo root; the
Dockerfile lives at `apps/web/Dockerfile`):

```bash
# Tag from package.json so the image version tracks the release
VERSION=$(node -p "require('./package.json').version")

docker buildx build \
  --builder multiarch \
  -f apps/web/Dockerfile \
  --platform linux/amd64,linux/arm64 \
  -t masize/lawallet-nwc:${VERSION} \
  -t masize/lawallet-nwc:latest \
  --push \
  .
```

Notes:

- **`-f apps/web/Dockerfile` is required** — there is no Dockerfile at the repo
  root. The context must stay `.` (root) so the build can copy the workspace
  manifests and packages.
- **`--platform linux/amd64,linux/arm64`** builds both architectures and bundles
  them under one tag as a manifest list. Consumers automatically pull the
  variant matching their host.
- **`--push`** is needed for multi-arch: a multi-platform result can't be loaded
  into the local Docker image store (`--load` only supports a single platform),
  so it goes straight to the registry.
- Building `amd64` on an Apple Silicon machine (or vice versa) runs under
  emulation and is **slow** — expect several minutes. CI runners build natively
  and are faster.

### Low-memory hosts (sequential build)

The one-shot command above builds **both** architectures in parallel, and on a
single-arch host one of them runs under QEMU emulation. Two heavy
`pnpm install` + `next build` runs at once can exhaust a small Docker VM — e.g.
the default ~8 GB Docker Desktop VM gets OOM-killed
(`ResourceExhausted: cannot allocate memory`) during `pnpm install`.

Either raise the Docker VM memory (Docker Desktop → Settings → Resources, ≥ 12 GB),
or build each architecture **sequentially** and assemble the manifest afterward —
this is also exactly how the CI matrix does it:

```bash
VERSION=$(node -p "require('./package.json').version")
REPO=masize/lawallet-nwc

# Build + push each arch on its own, by digest (no throwaway tags)
docker buildx build --builder multiarch -f apps/web/Dockerfile \
  --platform linux/arm64 --metadata-file /tmp/arm64.json \
  --output "type=image,name=${REPO},push-by-digest=true,push=true" .

docker buildx build --builder multiarch -f apps/web/Dockerfile \
  --platform linux/amd64 --metadata-file /tmp/amd64.json \
  --output "type=image,name=${REPO},push-by-digest=true,push=true" .

# Combine the two digests into one multi-arch manifest under the real tags
ARM=$(node -p "require('/tmp/arm64.json')['containerimage.digest']")
AMD=$(node -p "require('/tmp/amd64.json')['containerimage.digest']")
docker buildx imagetools create \
  -t ${REPO}:${VERSION} -t ${REPO}:latest \
  ${REPO}@${ARM} ${REPO}@${AMD}
```

### Verify the push

Inspect the manifest list to confirm both architectures landed:

```bash
docker buildx imagetools inspect masize/lawallet-nwc:latest
```

You should see two entries under `Manifests:` —
`platform: linux/amd64` and `platform: linux/arm64`.

## Automated publishing

`.github/workflows/docker-publish.yml` runs the exact build above on GitHub
Actions (native multi-arch via `docker/setup-qemu-action` +
`docker/setup-buildx-action`). It triggers on:

- **a published GitHub Release** — tags the image with the release version and
  `latest`; and
- **manual dispatch** (`workflow_dispatch`) — for ad-hoc rebuilds.

It requires two repository secrets:

| Secret | Value |
|--------|-------|
| `DOCKERHUB_USERNAME` | Docker Hub account (`masize`) |
| `DOCKERHUB_TOKEN` | A Docker Hub **access token** (Account → Security → New Access Token), *not* the password |

Without those secrets the login step fails fast; normal PR/push CI is
unaffected because this workflow never runs on those events.
