#!/usr/bin/env node
// Renders the release social card (2400×1350 PNG) shown at the top of each
// changelog and GitHub Release:
//
//   node scripts/release-image.mjs 2.9.0
//
// Reads docs/changelogs/assets/v<version>.json and writes v<version>.png next
// to it. The look lives in scripts/release-image/template.html. Uses the
// Chromium that apps/web's Playwright e2e setup already installs
// (`pnpm --filter @lawallet-nwc/web exec playwright install chromium`).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = (process.argv[2] ?? '').replace(/^v/, '')
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/release-image.mjs <x.y.z>')
  process.exit(1)
}

const assets = path.join(root, 'docs', 'changelogs', 'assets')
const data = JSON.parse(
  readFileSync(path.join(assets, `v${version}.json`), 'utf8')
)
if (data.cards?.length !== 6) {
  console.error('release image: the grid holds exactly 6 cards')
  process.exit(1)
}

const require = createRequire(path.join(root, 'apps', 'web', 'package.json'))
const { chromium } = require('@playwright/test')

const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 675 },
    deviceScaleFactor: 2
  })
  const template = path.join(root, 'scripts', 'release-image', 'template.html')
  await page.goto(pathToFileURL(template).href, { waitUntil: 'networkidle' })
  await page.evaluate(d => window.render({ ...d }), { ...data, version })
  await page.evaluate(() => document.fonts.ready)
  const out = path.join(assets, `v${version}.png`)
  await page.screenshot({ path: out })
  console.log(`wrote ${path.relative(root, out)}`)
} finally {
  await browser.close()
}
