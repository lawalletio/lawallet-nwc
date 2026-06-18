import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createDomainTesterServer, listen, closeServer } from './server.mjs'

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], {
    stdio: 'ignore',
  })
  return result.status === 0
}

async function startNgrokTunnel(port) {
  const token = process.env.NGROK_AUTHTOKEN
  if (!token) {
    throw new Error('NGROK_AUTHTOKEN is required for the ngrok tunnel provider.')
  }

  const ngrokModule = await import('@ngrok/ngrok')
  const ngrok = ngrokModule.default ?? ngrokModule
  const listener = await ngrok.forward({
    addr: port,
    authtoken: token,
    ...(process.env.NGROK_DOMAIN ? { domain: process.env.NGROK_DOMAIN } : {}),
  })

  return {
    provider: 'ngrok',
    publicUrl: listener.url(),
    close: async () => {
      if (typeof listener.close === 'function') {
        await listener.close()
      }
    },
  }
}

function startCloudflaredTunnel(localUrl) {
  if (!commandExists('cloudflared')) {
    throw new Error('cloudflared is not installed and no NGROK_AUTHTOKEN is available.')
  }

  const child = spawn('cloudflared', ['tunnel', '--url', localUrl], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  return new Promise((resolve, reject) => {
    let settled = false
    let output = ''
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(new Error(`Timed out waiting for cloudflared URL.\n${output}`))
    }, 60_000)

    function finish(error, value) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) {
        child.kill('SIGTERM')
        reject(error)
      } else {
        resolve(value)
      }
    }

    function handleChunk(chunk) {
      output += chunk
      const match = output.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i)
      if (match) {
        finish(null, {
          provider: 'cloudflared',
          publicUrl: match[0],
          close: async () => {
            if (child.exitCode !== null) return
            child.kill('SIGTERM')
            await Promise.race([
              once(child, 'exit'),
              new Promise(resolveClose => setTimeout(resolveClose, 5_000)),
            ])
            if (child.exitCode === null) {
              child.kill('SIGKILL')
            }
          },
        })
      }
    }

    child.stdout.on('data', handleChunk)
    child.stderr.on('data', handleChunk)
    child.once('error', error => finish(error))
    child.once('exit', (code, signal) => {
      if (!settled) {
        finish(new Error(`cloudflared exited before ready (code=${code}, signal=${signal}).\n${output}`))
      }
    })
  })
}

async function startTunnel(status) {
  const provider = process.env.DOMAIN_TUNNEL_PROVIDER?.trim().toLowerCase()
  if (provider === 'ngrok') return startNgrokTunnel(status.port)
  if (provider === 'cloudflared') return startCloudflaredTunnel(status.localUrl)

  if (process.env.NGROK_AUTHTOKEN) {
    return startNgrokTunnel(status.port)
  }

  return startCloudflaredTunnel(status.localUrl)
}

const host = process.env.DOMAIN_TESTER_HOST || '127.0.0.1'
const port = Number(process.env.PORT || process.env.DOMAIN_TESTER_PORT || 0)
const target = process.env.LAWALLET_TARGET || process.env.E2E_BASE_URL

const { server, getStatus } = createDomainTesterServer({ host, target })
await listen(server, { host, port })

const tunnel = await startTunnel(getStatus())
const publicUrl = tunnel.publicUrl
const payload = {
  ...getStatus(),
  provider: tunnel.provider,
  publicUrl,
  publicHost: new URL(publicUrl).host,
}

console.log(`DOMAIN_TESTER_READY ${JSON.stringify(payload)}`)

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  try {
    await tunnel.close()
  } finally {
    await closeServer(server)
  }
}

process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})
process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})
process.once('beforeExit', () => {
  void shutdown()
})

process.stdin.resume()
await once(process.stdin, 'end')
await shutdown()
