import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2020',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  clean: true
})
