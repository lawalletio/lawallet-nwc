import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    // The repo pins esbuild to a version that refuses to lower some modern
    // syntax to Vite's default (safari14-era) targets — an example app only
    // needs current browsers.
    target: 'es2022'
  }
})
