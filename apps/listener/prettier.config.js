// Mirrors the repo-root prettier.config.js. The root file is CJS
// (module.exports) under a `"type": "module"` package.json, so the prettier
// CLI can't load it from here — this ESM copy keeps `pnpm lint` working.
export default {
  semi: false,
  singleQuote: true,
  arrowParens: 'avoid',
  trailingComma: 'none',
  endOfLine: 'auto'
}
