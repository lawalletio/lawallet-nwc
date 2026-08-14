import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2020',
  platform: 'browser',
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', '@lawallet-nwc/sdk'],
  // esbuild drops top-of-file directives when bundling — re-add for RSC apps.
  banner: { js: "'use client'" }
})
