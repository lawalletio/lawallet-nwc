import { randomBytes } from 'node:crypto'
import { test, expect } from './fixtures/auth'
import {
  mintSessionToken,
  SEEDED_ADMIN_PUBKEY,
  SEEDED_USER_PUBKEY,
} from './fixtures/auth'
import { Role } from '../lib/auth/permissions'

/**
 * Connect Card E2E (Month 5 Theme B).
 *
 * Exercises the real server + database across the card activation lifecycle:
 *   design → initialize (bulk-write) → activation-QR → public preview →
 *   claim (ownership transfer + wallet bind) → pair → re-claim rejected →
 *   rescue (re-issue + unpair).
 *
 * `card-installer` (bulk write) and `card-manager` (QR print) are external
 * Android apps; here we call the same backend routes they hit. The **pay** leg
 * (LNURL invoice minted through the holder's NWC wallet) needs a live Nostr
 * relay, which Playwright can't provide — it's covered by the NWC-mocked
 * integration suites (`tests/integration/api/lud16.test.ts` and the card scan
 * pay tests). This spec stops at a paired, wallet-bound card.
 */

// A design inserted by the deterministic seed (mocks/card-design.ts).
const SEED_DESIGN_ID = 'design-001'

/** A unique 7-byte NTAG424 UID (hex) — never collides with the seed or peers. */
function freshCardUid(): string {
  return randomBytes(7).toString('hex').toUpperCase()
}

const adminAuth = () => ({
  Authorization: `Bearer ${mintSessionToken(SEEDED_ADMIN_PUBKEY, Role.ADMIN)}`,
})
const userAuth = () => ({
  Authorization: `Bearer ${mintSessionToken(SEEDED_USER_PUBKEY, Role.USER)}`,
})

test.describe('Connect Card — activation lifecycle', () => {
  test('initialize → QR → preview → claim → pair → re-claim blocked → rescue', async ({
    request,
  }) => {
    const admin = adminAuth()
    const user = userAuth()
    const uid = freshCardUid()

    let cardId = ''
    let tokenId = ''

    await test.step('initialize an unowned card against a seeded design', async () => {
      const res = await request.post('/api/cards', {
        headers: admin,
        data: { id: uid, designId: SEED_DESIGN_ID, kind: 'SIMPLE' },
      })
      expect(res.status()).toBe(200)
      const card = await res.json()
      cardId = card.id
      expect(cardId).toBeTruthy()
      expect(card.design.id).toBe(SEED_DESIGN_ID)
      expect(card.kind).toBe('SIMPLE')
      // Freshly initialized = unowned until someone activates it.
      expect(card.pubkey ?? null).toBeNull()
    })

    await test.step('mint a ONE_TIME activation QR for the card', async () => {
      const res = await request.post(`/api/cards/${cardId}/activation-tokens`, {
        headers: admin,
        data: { qrKind: 'ONE_TIME' },
      })
      expect(res.status()).toBe(201)
      const body = await res.json()
      tokenId = body.tokenId
      expect(tokenId).toBeTruthy()
      expect(body.qrKind).toBe('ONE_TIME')
      // The QR the wallet scans points at the activate route for this token.
      expect(body.qrPayload).toContain(`/wallet/activate/${tokenId}`)
    })

    await test.step('public preview shows design + kind, leaks no secrets', async () => {
      // No auth header — the scanner previews before the claimer signs in.
      const res = await request.get(`/api/activation-tokens/${tokenId}`)
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('PENDING')
      expect(body.qrKind).toBe('ONE_TIME')
      expect(body.card.design.id).toBe(SEED_DESIGN_ID)
      // NTAG keys / holder identity must never appear in the public preview.
      const serialized = JSON.stringify(body)
      expect(serialized).not.toContain('"k0"')
      expect(serialized).not.toContain('pubkey')
    })

    await test.step('claimer activates: ownership transfers + wallet binds', async () => {
      const res = await request.post(`/api/activation-tokens/${tokenId}/claim`, {
        headers: user,
        data: { remoteWalletId: null },
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.qrKind).toBe('ONE_TIME')
      expect(body.card.id).toBe(cardId)
      expect(body.card.pubkey).toBe(SEEDED_USER_PUBKEY)
      // The seeded user has an ACTIVE default NWC wallet, so an unspecified
      // wallet falls back to it — the card comes out bound and payable.
      expect(body.card.remoteWalletId).toBeTruthy()
    })

    await test.step('card is now paired to the claimer', async () => {
      const res = await request.get(`/api/cards/${cardId}`, { headers: admin })
      expect(res.status()).toBe(200)
      const card = await res.json()
      expect(card.pubkey).toBe(SEEDED_USER_PUBKEY)
    })

    await test.step('a second scan of the burned QR is rejected', async () => {
      const res = await request.post(`/api/activation-tokens/${tokenId}/claim`, {
        headers: user,
        data: { remoteWalletId: null },
      })
      expect(res.status()).toBe(409)
    })

    await test.step('rescue re-issues a fresh QR and unpairs the card', async () => {
      const res = await request.post(`/api/cards/${cardId}/rescue`, {
        headers: admin,
        data: {},
      })
      expect(res.status()).toBe(201)
      const body = await res.json()
      expect(body.qrKind).toBe('ONE_TIME')
      expect(body.tokenId).not.toBe(tokenId)

      const cardRes = await request.get(`/api/cards/${cardId}`, { headers: admin })
      const card = await cardRes.json()
      // Rescued card returns to a fresh, unassigned state.
      expect(card.pubkey ?? null).toBeNull()

      // The previous token is no longer claimable.
      const stale = await request.get(`/api/activation-tokens/${tokenId}`)
      const staleBody = await stale.json()
      expect(staleBody.status).not.toBe('PENDING')
    })
  })

  test('FOREVER QR is rejected for a SIMPLE card (MASTER share deferred)', async ({
    request,
  }) => {
    const admin = adminAuth()
    const create = await request.post('/api/cards', {
      headers: admin,
      data: { id: freshCardUid(), designId: SEED_DESIGN_ID, kind: 'SIMPLE' },
    })
    const card = await create.json()

    const res = await request.post(`/api/cards/${card.id}/activation-tokens`, {
      headers: admin,
      data: { qrKind: 'FOREVER' },
    })
    expect(res.status()).toBe(400)
  })

  test('activate page renders the scanned card preview', async ({ page, request }) => {
    const admin = adminAuth()
    const create = await request.post('/api/cards', {
      headers: admin,
      data: { id: freshCardUid(), designId: SEED_DESIGN_ID, kind: 'SIMPLE' },
    })
    const card = await create.json()
    const mint = await request.post(`/api/cards/${card.id}/activation-tokens`, {
      headers: admin,
      data: { qrKind: 'ONE_TIME' },
    })
    const { tokenId } = await mint.json()

    // The QR opens the wallet at this route; the client fetches the public
    // preview and renders the activation surface before the user signs in.
    await page.goto(`/wallet/activate/${tokenId}`)
    await expect(page.getByText(/activate your card/i)).toBeVisible()
  })
})
