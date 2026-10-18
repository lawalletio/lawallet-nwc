// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Real config (env → parse → route): the fingerprint filtering lives in
// lib/config, so mocking it would skip the logic under test.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

const FP =
  '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5'
// base64url (no padding) of the raw 32 bytes above, computed with
// `xxd -r -p | base64 | tr '+/' '-_' | tr -d '='`.
const FP_B64URL = 'FG3pg8VzBlDY7rmVLzT8ZBagg0LmHb6oigSWsj_PROU'
const FP2 = Array(32).fill('AB').join(':')

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.DATABASE_URL = 'postgresql://localhost/test'
  delete process.env.ANDROID_APP_PACKAGE
  delete process.env.ANDROID_APP_CERT_SHA256
  vi.resetModules()
})

afterEach(() => {
  process.env = originalEnv
})

async function fetchAssetLinks() {
  const { GET } = await import('@/app/.well-known/assetlinks.json/route')
  const res = GET()
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('application/json')
  return res.json()
}

describe('GET /.well-known/assetlinks.json', () => {
  it('returns [] when no fingerprint is configured', async () => {
    expect(await fetchAssetLinks()).toEqual([])
  })

  it('grants login creds + App Links to the configured app', async () => {
    process.env.ANDROID_APP_CERT_SHA256 = `${FP}, ${FP2.toLowerCase()}`
    expect(await fetchAssetLinks()).toEqual([
      {
        relation: [
          'delegate_permission/common.get_login_creds',
          'delegate_permission/common.handle_all_urls'
        ],
        target: {
          namespace: 'android_app',
          package_name: 'io.lawallet.wallet',
          sha256_cert_fingerprints: [FP, FP2]
        }
      }
    ])
  })

  it('honors ANDROID_APP_PACKAGE', async () => {
    process.env.ANDROID_APP_PACKAGE = 'com.example.fork'
    process.env.ANDROID_APP_CERT_SHA256 = FP
    const [statement] = await fetchAssetLinks()
    expect(statement.target.package_name).toBe('com.example.fork')
  })

  it('skips invalid fingerprints', async () => {
    process.env.ANDROID_APP_CERT_SHA256 = [
      'not-a-fingerprint',
      FP.slice(3), // 31 bytes
      FP.replaceAll(':', ''), // no colons
      FP
    ].join(',')
    const [statement] = await fetchAssetLinks()
    expect(statement.target.sha256_cert_fingerprints).toEqual([FP])
  })

  it('returns [] when every fingerprint is invalid', async () => {
    process.env.ANDROID_APP_CERT_SHA256 = 'nope,ZZ:ZZ'
    expect(await fetchAssetLinks()).toEqual([])
  })
})

describe('androidApkKeyHashOrigins', () => {
  async function origins() {
    const { androidApkKeyHashOrigins } = await import('@/lib/auth/passkey')
    return androidApkKeyHashOrigins()
  }

  it('is empty without fingerprints', async () => {
    expect(await origins()).toEqual([])
  })

  it('encodes each fingerprint as base64url without padding', async () => {
    process.env.ANDROID_APP_CERT_SHA256 = `${FP.toLowerCase()},bogus`
    expect(await origins()).toEqual([`android:apk-key-hash:${FP_B64URL}`])
  })
})
