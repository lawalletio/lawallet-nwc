import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // @lawallet-nwc/shared exports raw TypeScript (no build step) and Node
  // refuses to type-strip under node_modules — it MUST be bundled in.
  noExternal: ['@lawallet-nwc/shared']
})
