import { defineConfig } from 'vitest/config'

// Deliberately standalone: without it, vitest loads vite.config.ts, which
// imports the operator backend (and therefore @lawallet-nwc/sdk's build
// output) and generates an admin key as a side effect — just to run a
// node:crypto unit test. It also made `test` depend on packages/sdk having
// been built first, which broke the release pipeline's task ordering.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts']
  }
})
