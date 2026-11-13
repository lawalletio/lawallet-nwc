// @vitest-environment node
import { createHash } from 'crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { secret: 'a'.repeat(48), enabled: true },
    keyVault: { secret: 'b'.repeat(48), enabled: true },
    maintenance: { enabled: false },
    rateLimit: { enabled: false },
    requestLimits: { maxJsonSize: 102400, maxBodySize: 1048576 },
    isDevelopment: false,
    isTest: true
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: vi.fn(() => undefined)
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { auth: {}, sensitive: {} }
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: new Proxy({}, { get: (_t, key) => String(key) }),
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() })
}))

const settings = vi.hoisted(() => ({
  current: { email_login_enabled: 'true' } as Record<string, string>
}))
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => settings.current)
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: vi.fn(() => true)
}))

vi.mock('@/lib/public-url', () => ({
  resolvePublicEndpoint: vi.fn(async () => ({
    host: 'wallet.test',
    url: 'https://wallet.test'
  }))
}))

vi.mock('@/lib/user', () => ({
  createNewUser: vi.fn(async () => ({}))
}))

vi.mock('@/lib/nostr/profile-cache', () => ({
  resolveProfiles: vi.fn(async () => [
    { pubkey: 'x', displayName: 'Alice', picture: 'https://img.test/a.png' }
  ])
}))

import { POST as requestRoute } from '@/app/api/auth/email/request/route'
import { POST as previewRoute } from '@/app/api/auth/email/preview/route'
import { POST as verifyRoute } from '@/app/api/auth/email/verify/route'
import { sendEmail } from '@/lib/email/send'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { createNewUser } from '@/lib/user'
import { resolveProfiles } from '@/lib/nostr/profile-cache'
import { decryptNsec, encryptNsec } from '@/lib/auth/key-vault'
import { getPublicKeyFromPrivate } from '@/lib/nostr'
import { ServiceUnavailableError } from '@/types/server/errors'

// Model methods are vi.fn()s; the client typing hides that.
const db = prismaMock as any
const TOKEN = 'A'.repeat(43)
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
const post = (path: string, body: unknown) =>
  createNextRequest(`http://localhost:3000${path}`, { method: 'POST', body })

beforeEach(() => {
  resetPrismaMock()
  vi.mocked(sendEmail).mockReset()
  vi.mocked(rateLimit).mockReset()
  vi.mocked(createNewUser)
    .mockReset()
    .mockResolvedValue({} as never)
  settings.current = { email_login_enabled: 'true' }
  db.emailLoginToken.deleteMany.mockResolvedValue({ count: 0 } as never)
})

describe('POST /api/auth/email/request', () => {
  it('sends the signup template to an unknown email and stores only the token hash', async () => {
    db.emailIdentity.findUnique.mockResolvedValue(null)
    db.emailLoginToken.create.mockResolvedValue({} as never)

    const res = await requestRoute(
      post('/api/auth/email/request', { email: '  New@Example.COM ' })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const mail = vi.mocked(sendEmail).mock.calls[0][0]
    expect(mail.to).toBe('new@example.com')
    expect(mail.template).toBe('signup')
    const token = mail.data!.link!.split('#token=')[1]
    expect(mail.data!.link).toMatch(
      /^https:\/\/wallet\.test\/admin\/auth\/email#token=/
    )
    const stored = db.emailLoginToken.create.mock.calls[0][0].data
    expect(stored.tokenHash).toBe(sha256(token))
    expect(stored.email).toBe('new@example.com')
    expect(JSON.stringify(stored)).not.toContain(token)
  })

  it('sends the login template to a known email with the same response', async () => {
    db.emailIdentity.findUnique.mockResolvedValue({ user: { id: 'u1' } } as never)
    db.emailLoginToken.create.mockResolvedValue({} as never)

    const res = await requestRoute(
      post('/api/auth/email/request', { email: 'old@example.com' })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(vi.mocked(sendEmail).mock.calls[0][0].template).toBe('login')
  })

  it('links wallet sign-ins to the wallet landing', async () => {
    db.emailIdentity.findUnique.mockResolvedValue(null)
    db.emailLoginToken.create.mockResolvedValue({} as never)
    await requestRoute(
      post('/api/auth/email/request', { email: 'a@b.co', context: 'wallet' })
    )
    expect(vi.mocked(sendEmail).mock.calls[0][0].data!.link).toMatch(
      /\/wallet\/auth\/email#token=[\w-]+$/
    )
  })

  it('links every other sign-in to the admin landing', async () => {
    db.emailIdentity.findUnique.mockResolvedValue(null)
    db.emailLoginToken.create.mockResolvedValue({} as never)
    await requestRoute(post('/api/auth/email/request', { email: 'a@b.co' }))
    expect(vi.mocked(sendEmail).mock.calls[0][0].data!.link).toMatch(
      /\/admin\/auth\/email#token=[\w-]+$/
    )
  })

  it('carries a pending address claim in the link fragment', async () => {
    db.emailIdentity.findUnique.mockResolvedValue(null)
    db.emailLoginToken.create.mockResolvedValue({} as never)
    await requestRoute(
      post('/api/auth/email/request', {
        email: 'a@b.co',
        context: 'wallet',
        claimUsername: 'satoshi'
      })
    )
    expect(vi.mocked(sendEmail).mock.calls[0][0].data!.link).toMatch(
      /\/wallet\/auth\/email#token=[\w-]+&claim=satoshi$/
    )
  })

  it('rejects an invalid claim username', async () => {
    const res = await requestRoute(
      post('/api/auth/email/request', {
        email: 'a@b.co',
        claimUsername: 'Bad&ctx=x'
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects an unknown login context', async () => {
    const res = await requestRoute(
      post('/api/auth/email/request', { email: 'a@b.co', context: 'evil' })
    )
    expect(res.status).toBe(400)
  })

  it('applies a per-address rate limit', async () => {
    db.emailIdentity.findUnique.mockResolvedValue(null)
    db.emailLoginToken.create.mockResolvedValue({} as never)
    await requestRoute(post('/api/auth/email/request', { email: 'a@b.co' }))
    expect(vi.mocked(rateLimit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bucket: 'email-login', identifier: 'a@b.co' })
    )
  })

  it('reports a failed send instead of success', async () => {
    db.emailIdentity.findUnique.mockResolvedValue(null)
    db.emailLoginToken.create.mockResolvedValue({} as never)
    vi.mocked(sendEmail).mockRejectedValue(
      new ServiceUnavailableError("Couldn't send the email via SMTP: refused")
    )

    const res = await requestRoute(
      post('/api/auth/email/request', { email: 'a@b.co' })
    )

    expect(res.status).toBe(503)
    expect((await res.json()).error.message).toBe(
      "Couldn't send the email via SMTP: refused"
    )
  })

  it('rejects a malformed email', async () => {
    const res = await requestRoute(
      post('/api/auth/email/request', { email: 'not-an-email' })
    )
    expect(res.status).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('is 404 when email login is disabled', async () => {
    settings.current = {}
    const res = await requestRoute(
      post('/api/auth/email/request', { email: 'a@b.co' })
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/auth/email/preview', () => {
  it('previews a returning user without consuming the token', async () => {
    db.emailLoginToken.findUnique.mockResolvedValue({
      email: 'alice@example.com',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000)
    } as never)
    db.emailIdentity.findUnique.mockResolvedValue({
      user: {
        id: 'u1',
        pubkey: 'a'.repeat(64)
      }
    } as never)

    const res = await previewRoute(
      post('/api/auth/email/preview', { token: TOKEN })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      isNew: false,
      email: 'a•••e@example.com',
      pubkey: 'a'.repeat(64),
      displayName: 'Alice',
      picture: 'https://img.test/a.png'
    })
    expect(db.emailLoginToken.updateMany).not.toHaveBeenCalled()
  })

  it('re-fetches a profile the cache reports as not found', async () => {
    // A "not found" cache row yields no profile and is in backoff; a
    // just-published kind-0 must still show up on the next link.
    db.emailLoginToken.findUnique.mockResolvedValue({
      email: 'alice@example.com',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000)
    } as never)
    db.emailIdentity.findUnique.mockResolvedValue({
      user: {
        id: 'u1',
        pubkey: 'a'.repeat(64)
      }
    } as never)
    vi.mocked(resolveProfiles)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          pubkey: 'a'.repeat(64),
          npub: '',
          displayName: 'Alice',
          fetchedAt: Date.now()
        }
      ])

    const res = await previewRoute(
      post('/api/auth/email/preview', { token: TOKEN })
    )

    expect((await res.json()).displayName).toBe('Alice')
    expect(vi.mocked(resolveProfiles).mock.calls[1][1]).toEqual({ force: true })
  })

  it('rejects an expired token', async () => {
    db.emailLoginToken.findUnique.mockResolvedValue({
      email: 'alice@example.com',
      usedAt: null,
      expiresAt: new Date(Date.now() - 1)
    } as never)
    const res = await previewRoute(
      post('/api/auth/email/preview', { token: TOKEN })
    )
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/email/verify', () => {
  it('creates an account with a custodied key for a new email', async () => {
    db.emailLoginToken.updateMany.mockResolvedValue({ count: 1 } as never)
    db.emailLoginToken.findUnique.mockResolvedValue({
      email: 'new@example.com'
    } as never)
    db.emailIdentity.findUnique.mockResolvedValue(null)
    db.emailIdentity.create.mockResolvedValue({} as never)
    db.managedNostrKey.create.mockResolvedValue({} as never)

    const res = await verifyRoute(
      post('/api/auth/email/verify', { token: TOKEN })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isNew).toBe(true)
    expect(getPublicKeyFromPrivate(body.secretHex)).toBe(body.pubkey)

    const [pubkey, opts] = vi.mocked(createNewUser).mock.calls[0]
    expect(pubkey).toBe(body.pubkey)
    const userId = opts!.userId!
    expect(db.emailIdentity.create).toHaveBeenCalledWith({
      data: { email: 'new@example.com', userId }
    })
    const { ciphertext } = db.managedNostrKey.create.mock.calls[0][0].data
    expect(decryptNsec(ciphertext as Uint8Array, userId)).toBe(body.secretHex)

    // Consumed atomically: only an unused, unexpired row matches.
    const where = db.emailLoginToken.updateMany.mock.calls[0][0].where
    expect(where).toMatchObject({ tokenHash: sha256(TOKEN), usedAt: null })
  })

  it('returns the existing custodied key for a known email', async () => {
    const secret = '1'.repeat(64)
    db.emailLoginToken.updateMany.mockResolvedValue({ count: 1 } as never)
    db.emailLoginToken.findUnique.mockResolvedValue({
      email: 'old@example.com'
    } as never)
    db.emailIdentity.findUnique.mockResolvedValue({
      user: {
        id: 'u1',
        pubkey: getPublicKeyFromPrivate(secret),
        managedNostrKey: { ciphertext: encryptNsec(secret, 'u1') }
      }
    } as never)

    const res = await verifyRoute(
      post('/api/auth/email/verify', { token: TOKEN })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      secretHex: secret,
      pubkey: getPublicKeyFromPrivate(secret),
      isNew: false
    })
    expect(createNewUser).not.toHaveBeenCalled()
  })

  it('rejects a used or expired token', async () => {
    db.emailLoginToken.updateMany.mockResolvedValue({ count: 0 } as never)
    const res = await verifyRoute(
      post('/api/auth/email/verify', { token: TOKEN })
    )
    expect(res.status).toBe(401)
    expect(createNewUser).not.toHaveBeenCalled()
  })

  it('rejects a malformed token', async () => {
    const res = await verifyRoute(
      post('/api/auth/email/verify', { token: 'short' })
    )
    expect(res.status).toBe(400)
  })
})
