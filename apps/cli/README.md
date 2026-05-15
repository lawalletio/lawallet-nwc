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
