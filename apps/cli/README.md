# LaWallet CLI

Global CLI entrypoint for bootstrapping and managing a local LaWallet install.

## Commands

```bash
lawallet install
lawallet install --dir ~/projects --mode docker
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

## Docker smoke test

To verify the bootstrap installer end-to-end inside an isolated Docker-in-Docker
environment:

```bash
bash ./scripts/test-install-cli-docker.sh
```

That builds a disposable Linux runner image, installs the CLI globally inside
it, clones the repo, starts the bundled `lawallet + postgres` compose stack,
and checks that `http://127.0.0.1:2288/api/openapi.json` responds.

To debug the runner interactively instead of launching the smoke test:

```bash
bash ./scripts/test-install-cli-docker.sh bash
```
