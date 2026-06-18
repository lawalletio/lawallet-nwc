import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { test, expect } from './fixtures/auth'
import { E2E_BASE_URL } from './env'

interface DomainTesterInfo {
  rewriteEnabled: boolean
  target: string
  port: number
  localUrl: string
  provider: 'cloudflared' | 'ngrok'
  publicUrl: string
  publicHost: string
}

interface StartedDomainTester {
  child: ChildProcessWithoutNullStreams
  info: DomainTesterInfo
}

const liveEnabled = process.env.E2E_DOMAIN_LIVE === '1'
const hasTunnelProvider =
  Boolean(process.env.NGROK_AUTHTOKEN) ||
  spawnSync('sh', ['-lc', 'command -v cloudflared'], { stdio: 'ignore' }).status === 0

test.skip(
  !liveEnabled || !hasTunnelProvider,
  'Domain routing E2E requires E2E_DOMAIN_LIVE=1 and either cloudflared or NGROK_AUTHTOKEN.',
)

test.describe.configure({ mode: 'serial' })

const webRoot = process.cwd()
const repoRoot = path.resolve(webRoot, '../..')
const READY_PREFIX = 'DOMAIN_TESTER_READY '

let tester: StartedDomainTester | null = null

function startDomainTester(): Promise<StartedDomainTester> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['--filter', '@lawallet-nwc/domain-tester', 'start:tunnel'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          LAWALLET_TARGET: E2E_BASE_URL,
          REWRITE_ENABLED: 'false',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    let settled = false
    let output = ''
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(new Error(`Timed out waiting for domain tester.\n${output}`))
    }, 60_000)

    function settleWithError(error: Error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    }

    child.stdout.on('data', chunk => {
      output += chunk
      for (const line of output.split(/\r?\n/)) {
        if (!line.startsWith(READY_PREFIX)) continue
        try {
          const info = JSON.parse(line.slice(READY_PREFIX.length)) as DomainTesterInfo
          settled = true
          clearTimeout(timeout)
          resolve({ child, info })
        } catch (error) {
          settleWithError(error instanceof Error ? error : new Error('Invalid tester payload'))
        }
      }
    })

    child.stderr.on('data', chunk => {
      output += chunk
    })

    child.once('error', settleWithError)
    child.once('exit', (code, signal) => {
      if (!settled) {
        settleWithError(
          new Error(`Domain tester exited before ready (code=${code}, signal=${signal}).\n${output}`),
        )
      }
    })
  })
}

async function stopDomainTester(started: StartedDomainTester | null) {
  if (!started) return
  if (started.child.exitCode !== null) return

  started.child.stdin.end()
  started.child.kill('SIGTERM')

  await Promise.race([
    once(started.child, 'exit'),
    new Promise<void>(resolve => {
      setTimeout(() => {
        if (started.child.exitCode === null) {
          started.child.kill('SIGKILL')
        }
        resolve()
      }, 5_000)
    }),
  ])
}

async function setRewrite(enabled: boolean) {
  if (!tester) throw new Error('Domain tester was not started')
  const response = await fetch(`${tester.info.localUrl}/__control/rewrite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  expect(response.status).toBe(200)
}

async function readPublicSettings(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/settings')
    return response.json() as Promise<{ domain_verified?: string }>
  })
}

test.beforeAll(async () => {
  tester = await startDomainTester()
})

test.afterAll(async () => {
  await stopDomainTester(tester)
})

test('verified .well-known rewrite clears domain setup alerts', async ({
  adminPage,
  request,
}) => {
  test.slow()
  if (!tester) throw new Error('Domain tester was not started')

  const { publicHost, publicUrl } = tester.info
  await setRewrite(false)

  await adminPage.goto('/admin/settings?tab=infrastructure&domainSetup=open')

  const dialog = adminPage.getByRole('dialog', { name: /Domain setup/i })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Domain', { exact: true }).fill(publicHost)
  await dialog.getByLabel('LaWallet endpoint', { exact: true }).fill(E2E_BASE_URL)
  await dialog.getByRole('button', { name: /Verify/i }).click()

  await expect(
    dialog.getByRole('heading', { name: /Route \.well-known here|Saved\. Check routing next/i }),
  ).toBeVisible({ timeout: 30_000 })

  await expect
    .poll(async () => (await readPublicSettings(adminPage)).domain_verified)
    .toBe('false')

  await dialog.getByRole('button', { name: /Done/i }).click()
  await expect(dialog).toBeHidden()
  await expect(adminPage.getByRole('button', { name: /Fix domain/i }).first()).toBeVisible()

  await setRewrite(true)
  await adminPage.getByRole('button', { name: /Fix domain/i }).first().click()
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Domain', { exact: true }).fill(publicHost)
  await dialog.getByLabel('LaWallet endpoint', { exact: true }).fill(E2E_BASE_URL)
  await dialog.getByRole('button', { name: /Verify/i }).click()

  await expect(
    dialog.getByRole('heading', { name: /Discovery is ready/i }),
  ).toBeVisible({ timeout: 30_000 })

  const probeId = `e2e-${Date.now()}`
  const probeResponse = await request.get(
    `${publicUrl}/.well-known/lawallet.json?probe=${probeId}`,
    { headers: { 'ngrok-skip-browser-warning': 'true' } },
  )
  expect(probeResponse.status()).toBe(200)
  expect(await probeResponse.json()).toMatchObject({
    service: 'lawallet',
    probe: probeId,
  })

  const nip05Response = await request.get(`${publicUrl}/.well-known/nostr.json?name=_`, {
    headers: { 'ngrok-skip-browser-warning': 'true' },
  })
  expect(nip05Response.status()).toBe(200)
  expect(await nip05Response.json()).toMatchObject({ names: {} })

  const lnurlResponse = await request.get(`${publicUrl}/.well-known/lnurlp/alice`, {
    headers: { 'ngrok-skip-browser-warning': 'true' },
  })
  expect(lnurlResponse.status()).toBe(200)
  const lnurlBody = await lnurlResponse.json()
  expect(lnurlBody.tag).toBe('payRequest')
  expect(lnurlBody.callback).toContain('/api/lud16/alice/cb')

  await dialog.getByRole('button', { name: /Done/i }).click()
  await expect(dialog).toBeHidden()

  await expect
    .poll(async () => (await readPublicSettings(adminPage)).domain_verified)
    .toBe('true')
  await expect(adminPage.getByRole('button', { name: /Fix domain/i })).toHaveCount(0)
  await expect(adminPage.getByText('Setup Domain')).toHaveCount(0)

  await adminPage.goto('/admin/cards')
  await expect(adminPage.getByText('Configure your domain')).toHaveCount(0)
  await expect(adminPage.getByRole('button', { name: /Configure now/i })).toHaveCount(0)
})
