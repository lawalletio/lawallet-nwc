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
    requestLimits: { maxJsonSize: 102400, maxBodySize: 1048576 },
    isDevelopment: false,
    isTest: true
  }))
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }),
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
vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))
vi.mock('@/lib/auth/account', () => ({ resolveAccountByPubkey: vi.fn() }))
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ email_login_enabled: 'true' }))
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

import { POST as linkRoute } from '@/app/api/account/emails/route'
import { POST as verifyRoute } from '@/app/api/account/emails/verify/route'
import { DELETE as deleteRoute } from '@/app/api/account/emails/[email]/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { sendEmail } from '@/lib/email/send'
import { verifyMergeTicket } from '@/lib/account/proof'
import { decryptNsec, encryptNsec } from '@/lib/auth/key-vault'
import { getPublicKeyFromPrivate } from '@/lib/nostr'

const db = prismaMock as any
const TOKEN = 'T'.repeat(43)
const PK = 'a'.repeat(64)
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
const post = (path: string, body: unknown) =>
  createNextRequest(`http://localhost:3000${path}`, { method: 'POST', body })
const del = (email: string) =>
  deleteRoute(
    createNextRequest(
      `http://localhost:3000/api/account/emails/${encodeURIComponent(email)}`,
      { method: 'DELETE' }
    ),
    { params: Promise.resolve({ email: encodeURIComponent(email) }) }
  )

beforeEach(() => {
  resetPrismaMock()
  vi.mocked(sendEmail).mockReset()
  vi.mocked(authenticate).mockResolvedValue({ pubkey: PK } as never)
  vi.mocked(resolveAccountByPubkey).mockResolvedValue({ id: 'acct' } as never)
  db.emailLoginToken.create.mockResolvedValue({})
  db.emailLoginToken.deleteMany.mockResolvedValue({ count: 0 })
})

describe('POST /api/account/emails', () => {
  it('emails a link bound to the caller, storing only the token hash', async () => {
    db.emailIdentity.findUnique.mockResolvedValue(null)

    const res = await linkRoute(
      post('/api/account/emails', { email: 'New@Example.com' })
    )

    expect(res.status).toBe(200)
    const mail = vi.mocked(sendEmail).mock.calls[0][0]
    expect(mail).toMatchObject({ to: 'new@example.com', template: 'link' })
    expect(mail.data!.link).toMatch(
      /^https:\/\/wallet\.test\/wallet\/auth\/email#token=[\w-]+&ctx=link$/
    )
    const token = mail.data!.link!.match(/token=([\w-]+)/)![1]
    expect(db.emailLoginToken.create.mock.calls[0][0].data).toMatchObject({
      tokenHash: sha256(token),
      email: 'new@example.com',
      linkUserId: 'acct'
    })
  })

  it('409s for an email already on the account', async () => {
    db.emailIdentity.findUnique.mockResolvedValue({ userId: 'acct' })
    const res = await linkRoute(
      post('/api/account/emails', { email: 'me@example.com' })
    )
    expect(res.status).toBe(409)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('still sends (no oracle) when another account owns the email', async () => {
    db.emailIdentity.findUnique.mockResolvedValue({ userId: 'other' })
    const res = await linkRoute(
      post('/api/account/emails', { email: 'taken@example.com' })
    )
    expect(res.status).toBe(200)
    expect(sendEmail).toHaveBeenCalled()
  })
})

describe('POST /api/account/emails/verify', () => {
  function seedToken(email: string) {
    db.emailLoginToken.updateMany.mockResolvedValue({ count: 1 })
    db.emailLoginToken.findUnique.mockResolvedValue({
      email,
      linkUserId: 'acct'
    })
  }

  it('only consumes link tokens', async () => {
    seedToken('x@example.com')
    await verifyRoute(post('/api/account/emails/verify', { token: TOKEN }))
    expect(db.emailLoginToken.updateMany.mock.calls[0][0].where).toMatchObject({
      tokenHash: sha256(TOKEN),
      linkUserId: { not: null }
    })
  })

  it('rejects a used or sign-in token', async () => {
    db.emailLoginToken.updateMany.mockResolvedValue({ count: 0 })
    const res = await verifyRoute(
      post('/api/account/emails/verify', { token: TOKEN })
    )
    expect(res.status).toBe(401)
  })

  it('links an unclaimed email and gives a key-less account a hosted key', async () => {
    seedToken('new@example.com')
    db.emailIdentity.findUnique.mockResolvedValue(null)
    db.user.findUnique.mockResolvedValue({ managedNostrKey: null })
    db.nostrIdentity.create.mockResolvedValue({})
    db.managedNostrKey.create.mockResolvedValue({})
    db.emailIdentity.create.mockResolvedValue({})

    const res = await verifyRoute(
      post('/api/account/emails/verify', { token: TOKEN })
    )

    expect(await res.json()).toEqual({
      linked: true,
      email: 'n•••w@example.com'
    })
    expect(db.emailIdentity.create).toHaveBeenCalledWith({
      data: { email: 'new@example.com', userId: 'acct' }
    })
    // The new hosted key is a secondary identity of the same account.
    const identity = db.nostrIdentity.create.mock.calls[0][0].data
    expect(identity).toMatchObject({ userId: 'acct', isPrimary: false })
    const { ciphertext } = db.managedNostrKey.create.mock.calls[0][0].data
    expect(getPublicKeyFromPrivate(decryptNsec(ciphertext, 'acct'))).toBe(
      identity.pubkey
    )
  })

  it('reuses an existing hosted key', async () => {
    seedToken('second@example.com')
    db.emailIdentity.findUnique.mockResolvedValue(null)
    db.user.findUnique.mockResolvedValue({
      managedNostrKey: { userId: 'acct' }
    })
    db.emailIdentity.create.mockResolvedValue({})

    await verifyRoute(post('/api/account/emails/verify', { token: TOKEN }))

    expect(db.managedNostrKey.create).not.toHaveBeenCalled()
    expect(db.nostrIdentity.create).not.toHaveBeenCalled()
  })

  it('returns a merge ticket bound to both accounts when another owns it', async () => {
    seedToken('taken@example.com')
    db.emailIdentity.findUnique.mockResolvedValue({
      user: { id: 'other', pubkey: 'b'.repeat(64) }
    })

    const res = await verifyRoute(
      post('/api/account/emails/verify', { token: TOKEN })
    )
    const body = await res.json()

    expect(body.linked).toBe(false)
    expect(db.emailIdentity.create).not.toHaveBeenCalled()
    // Redeemable only by the requesting account's session.
    expect(verifyMergeTicket(body.mergeTicket, 'acct')).toMatchObject({
      survivorId: 'acct',
      absorbedId: 'other'
    })
    expect(() => verifyMergeTicket(body.mergeTicket, 'other')).toThrow()
  })
})

describe('DELETE /api/account/emails/:email', () => {
  const secret = '5'.repeat(64)
  const hostedPk = getPublicKeyFromPrivate(secret)

  it('refuses to remove the last way into an email-only account', async () => {
    db.user.findUnique.mockResolvedValue({
      pubkey: hostedPk,
      emailIdentities: [{ email: 'only@example.com' }],
      managedNostrKey: {
        ciphertext: encryptNsec(secret, 'acct'),
        exportedAt: null
      }
    })
    const res = await del('only@example.com')
    expect(res.status).toBe(409)
    expect(db.emailIdentity.delete).not.toHaveBeenCalled()
  })

  it('drops the email-only hosted key with the last email of a Nostr account', async () => {
    db.user.findUnique.mockResolvedValue({
      pubkey: PK,
      emailIdentities: [{ email: 'only@example.com' }],
      managedNostrKey: {
        ciphertext: encryptNsec(secret, 'acct'),
        exportedAt: null
      }
    })
    const res = await del('only@example.com')
    expect(res.status).toBe(200)
    expect(db.emailIdentity.delete).toHaveBeenCalledWith({
      where: { email: 'only@example.com' }
    })
    expect(db.managedNostrKey.delete).toHaveBeenCalledWith({
      where: { userId: 'acct' }
    })
    expect(db.nostrIdentity.deleteMany).toHaveBeenCalledWith({
      where: { pubkey: hostedPk, userId: 'acct', isPrimary: false }
    })
  })

  it('404s for an email that is not on the account', async () => {
    db.user.findUnique.mockResolvedValue({
      pubkey: PK,
      emailIdentities: [],
      managedNostrKey: null
    })
    expect((await del('nope@example.com')).status).toBe(404)
  })
})
