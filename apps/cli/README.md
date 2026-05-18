# LaWallet CLI

Global CLI entrypoint for bootstrapping and managing a local LaWallet install.

## Standalone bootstrap

The repo-root installer is designed to be hosted and fetched directly:

```bash
curl -fsSL https://raw.githubusercontent.com/lawalletio/lawallet-nwc/main/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/lawalletio/lawallet-nwc/main/install.sh | \
  bash -s -- --mode docker --yes
```

By default that script:

- installs `@lawallet-nwc/cli` into `~/.lawallet`
- downloads a bundled Node.js runtime if the machine does not already have a compatible one
- adds `~/.lawallet/bin` to the user's shell profile
- runs `lawallet install`

Useful environment overrides:

```bash
LAWALLET_REPO_URL=https://github.com/lawalletio/lawallet-nwc.git
LAWALLET_CLI_NPM_SPEC=@lawallet-nwc/cli@latest
LAWALLET_HOME=$HOME/.lawallet
LAWALLET_INSTALL_SKIP_RUN=true
LAWALLET_INSTALL_SKIP_PROFILE=true
LAWALLET_INSTALL_FORCE_NODE_DOWNLOAD=true
```

## Commands

```bash
lawallet install
lawallet install --dir ~/projects --mode docker
lawallet install --docs-port 3001 --openapi-port 4501
lawallet service status
lawallet service restart
```

## What `install` does

- prompts for a base install directory
- clones `lawallet-nwc`
- installs workspace dependencies with `pnpm`
- prefers Docker when it is available
- otherwise installs/runs PostgreSQL natively, migrates, builds, and starts the app

## Local bootstrap from this repo

From the monorepo root:

```bash
bash ./scripts/install-lawallet-cli.sh
```

That wrapper sets `LAWALLET_CLI_NPM_SPEC` to the local `apps/cli` package and
delegates into the same root [`install.sh`](../../install.sh) entrypoint used by the hosted flow.

## Docker smoke test

To verify the bootstrap installer end-to-end inside an isolated Docker-in-Docker
environment:

```bash
bash ./scripts/test-install-cli-docker.sh
```

That builds a disposable Linux runner image, installs the CLI globally inside
it, runs the root `install.sh` bootstrap, clones the repo, starts the bundled
`web + docs + openapi + postgres` compose stack, and checks:

- `http://127.0.0.1:2288/api/health`
- `http://127.0.0.1:3000/api/health`
- `http://127.0.0.1:4500/health`
- `http://127.0.0.1:4500/openapi.json`

To debug the runner interactively instead of launching the smoke test:

```bash
bash ./scripts/test-install-cli-docker.sh bash
```
