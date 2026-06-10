// Prints the resolved OpenAPI document as JSON. Used by scripts/docs-sync.mjs
// (repo root) and handy for piping into jq. Run with:
//   pnpm --filter @lawallet-nwc/openapi exec tsx scripts/dump.mjs
import { getOpenApiDocument } from '../src/index.ts'

const doc = getOpenApiDocument({
  serverUrl: process.env.OPENAPI_SERVER_URL ?? 'http://127.0.0.1:3000'
})

process.stdout.write(JSON.stringify(doc, null, 2))
