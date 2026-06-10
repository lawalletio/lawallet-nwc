import { test, expect } from '@playwright/test'

test.describe('smoke', () => {
  test('health endpoint responds', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
  })

  test('anonymous /admin shows the Nostr login, not the dashboard', async ({
    page
  }) => {
    await page.goto('/admin')
    // The login modal is forced for unauthenticated admin visits.
    await expect(
      page.getByText(/nostr|extension|nsec|bunker/i).first()
    ).toBeVisible()
  })

  test('LUD-16 resolves a seeded username', async ({ request }) => {
    const res = await request.get('/api/lud16/alice')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.tag).toBe('payRequest')
    expect(body.callback).toContain('/api/lud16/alice')
    expect(body.minSendable).toBeGreaterThan(0)
  })

  test('unknown LUD-16 username is a clean 404', async ({ request }) => {
    const res = await request.get('/api/lud16/definitely-not-seeded-xyz')
    expect(res.status()).toBe(404)
  })
})
