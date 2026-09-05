import { test, expect } from './fixtures/auth'
import {
  mintSessionToken,
  SEEDED_ADMIN_PUBKEY,
  SEEDED_USER_PUBKEY
} from './fixtures/auth'
import { Role } from '../lib/auth/permissions'

// Verifies the user-facing Remote Wallet detail page threads `isActive` into
// <RemoteWalletForwardingPanel walletActive=…> so an inactive wallet with no
// payments shows the conservative empty-state copy. Exercises the real server
// (JWT auth, Prisma, the forwarding receipts + receive-action routes) plus the
// real page wiring — the unit test in tests/unit/app/ pins the prop, this one
// confirms the resulting copy end-to-end.
//
// Runs serially and restores the wallet to ACTIVE in afterAll so the shared
// provisioned DB is not polluted for other e2e specs.

const CONSERVATIVE_COPY =
  'Payment activity is only available while the wallet is active.'

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

test.describe
  .serial('Remote Wallet detail — inactive-wallet empty-state', () => {
  let userToken: string
  let walletId: string

  test.beforeAll(async ({ request }) => {
    userToken = mintSessionToken(SEEDED_USER_PUBKEY, Role.USER)
    const listRes = await request.get('/api/remote-wallets', {
      headers: authHeaders(userToken)
    })
    expect(listRes.status()).toBe(200)
    const wallets = await listRes.json()
    expect(wallets.length).toBeGreaterThan(0)
    walletId = wallets[0].id
  })

  test.afterAll(async ({ request }) => {
    // Restore the wallet so other specs find it ACTIVE again.
    if (!walletId) return
    await request.patch(`/api/remote-wallets/${walletId}`, {
      headers: {
        ...authHeaders(userToken),
        'Content-Type': 'application/json'
      },
      data: { status: 'ACTIVE' }
    })
  })

  test('user surface shows the conservative copy for a DISABLED wallet with no payments', async ({
    userPage,
    request
  }) => {
    // Realistic trigger: the user's own setStatus toggle (owner-only PATCH).
    const patchRes = await request.patch(`/api/remote-wallets/${walletId}`, {
      headers: {
        ...authHeaders(userToken),
        'Content-Type': 'application/json'
      },
      data: { status: 'DISABLED' }
    })
    expect(patchRes.status()).toBe(200)
    expect((await patchRes.json()).status).toBe('DISABLED')

    // Open the user-facing detail page (the page under fix).
    await userPage.goto(`/wallet/settings/remote-wallets/${walletId}`)
    // Cold dev-server route compilation + auth hydration (GET /api/jwt) +
    // wallet fetch can take a while on first navigation; wait for the page
    // header to confirm the page mounted with wallet.data resolved.
    await expect(
      userPage.getByRole('heading', { name: 'Remote wallet' })
    ).toBeVisible({ timeout: 90_000 })

    // The "Payments received" tab renders the conservative empty-state copy
    // for an inactive wallet with no receipts and no NWC transactions.
    await userPage.getByRole('tab', { name: 'Payments received' }).click()
    await expect(userPage.getByText(CONSERVATIVE_COPY)).toBeVisible()
    await expect(
      userPage.getByText('No payments have been received by this wallet yet.')
    ).not.toBeVisible()
  })

  test('admin surface shows the same conservative copy for the same wallet', async ({
    adminPage
  }) => {
    // Wallet is DISABLED from the previous test (serial ordering). The admin
    // page's h1 is the wallet name (not "Remote wallet" like the user page),
    // so wait for the panel's tab directly.
    await adminPage.goto(`/admin/remote-wallets/${walletId}`)
    const paymentsTab = adminPage.getByRole('tab', {
      name: 'Payments received'
    })
    await expect(paymentsTab).toBeVisible({ timeout: 90_000 })
    await paymentsTab.click()
    await expect(adminPage.getByText(CONSERVATIVE_COPY)).toBeVisible()
  })

  test('admin fixture token is servicable (parity sanity guard)', async ({
    request
  }) => {
    // Guards against a false pass where the user-only path silently 401s and
    // the test still sees the conservative copy via a stale page state.
    const adminToken = mintSessionToken(SEEDED_ADMIN_PUBKEY, Role.ADMIN)
    const res = await request.get('/api/remote-wallets', {
      headers: authHeaders(adminToken)
    })
    expect(res.status()).toBe(200)
  })
})
