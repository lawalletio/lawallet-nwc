import { createServer } from 'node:http'
import { getOpenApiDocument } from '../src/index.ts'

const port = Number(process.env.OPENAPI_PORT ?? process.env.OPENAPI_DEV_PORT ?? 4500)
const host = process.env.OPENAPI_HOST ?? '127.0.0.1'

const server = createServer((req, res) => {
  const url = req.url ?? '/'

  if (url === '/health') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    })
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'openapi',
      }),
    )
    return
  }

  if (url === '/openapi.json' || url === '/') {
    const doc = getOpenApiDocument({
      serverUrl: process.env.OPENAPI_SERVER_URL ?? `http://127.0.0.1:2288`,
    })
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    })
    res.end(JSON.stringify(doc, null, 2))
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('Not found')
})

server.listen(port, host, () => {
  const base = `http://${host}:${port}`
  const cyan = '\x1b[36m'
  const dim = '\x1b[2m'
  const reset = '\x1b[0m'
  const bold = '\x1b[1m'
  process.stdout.write(
    `\n${bold}@lawallet-nwc/openapi${reset} ${dim}— dev server${reset}\n` +
      `  ${cyan}▶ Spec:${reset}       ${base}/openapi.json\n` +
      `  ${dim}Press Ctrl+C to stop${reset}\n\n`,
  )
})
