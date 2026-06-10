# apps/cli — installer CLI

Plain Node ESM (no TypeScript, no bundler). Entry: `src/index.js`; the
`install` command (`src/commands/install.js`) drives docker/native mode
selection, port auto-detection, and state persistence.

Reusable pure helpers live in `src/lib/`: `shared.js` (`createJwtSecret`,
instance ids), `process.js` (`findAvailablePort`, `runCommand`,
`commandExists`, `waitForHttp`), `docker.js`, `state.js` (env file writing).
Root `scripts/*.mjs` import these — keep them dependency-free and pure.

- Tests: `node --test` over `tests/*.test.js`
- Docker smoke test: `docker-smoke/run-smoke-test.sh` (exercises the public
  `install.sh` bootstrap end-to-end)
- The public entrypoint is repo-root `install.sh` (curl|bash), which installs
  this package and runs `lawallet install`
