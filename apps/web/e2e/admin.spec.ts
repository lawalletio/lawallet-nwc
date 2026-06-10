import { test, expect } from './fixtures/auth'

test.describe('admin dashboard (authenticated)', () => {
  test('admin sees the dashboard shell, not the login modal', async ({
    adminPage
  }) => {
    await adminPage.goto('/admin')
    // Sidebar platform nav — stable entries from admin-sidebar.tsx.
    await expect(
      adminPage.getByRole('link', { name: 'Users' })
    ).toBeVisible()
    await expect(
      adminPage.getByRole('link', { name: 'Cards' })
    ).toBeVisible()
  })

  test('users page lists seeded users', async ({ adminPage }) => {
    await adminPage.goto('/admin/users')
    // The deterministic seed inserts 10 users; the page should render rows
    // (any npub-ish text) rather than an empty state.
    await expect(adminPage.getByText(/npub1/i).first()).toBeVisible()
  })

  test('API rejects the admin token with a tampered signature', async ({
    request
  }) => {
    const { mintSessionToken, SEEDED_ADMIN_PUBKEY } = await import(
      './fixtures/auth'
    )
    const { Role } = await import('../lib/auth/permissions')
    const token = mintSessionToken(SEEDED_ADMIN_PUBKEY, Role.ADMIN)
    const tampered = token.slice(0, -2) + 'xx'
    const res = await request.get('/api/users', {
      headers: { Authorization: `Bearer ${tampered}` }
    })
    expect(res.status()).toBe(401)
  })

  test('API accepts the minted admin token', async ({ request }) => {
    const { mintSessionToken, SEEDED_ADMIN_PUBKEY } = await import(
      './fixtures/auth'
    )
    const { Role } = await import('../lib/auth/permissions')
    const token = mintSessionToken(SEEDED_ADMIN_PUBKEY, Role.ADMIN)
    const res = await request.get('/api/users', {
      headers: { Authorization: `Bearer ${token}` }
    })
    expect(res.status()).toBe(200)
  })
})
