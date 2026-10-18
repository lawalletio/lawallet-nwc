import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() })
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ login: vi.fn() })
}))

vi.mock('@/lib/client/passkey-api', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/client/passkey-api')>()
  return {
    ...actual,
    isPasskeySupported: () => true,
    authenticateWithPasskey: vi.fn()
  }
})

import { LoginOptions } from '@/components/wallet/onboarding/login-options'
import { authenticateWithPasskey } from '@/lib/client/passkey-api'

describe('LoginOptions', () => {
  // Android reports "no passkey here", provider failures and a missing
  // screen lock as NotAllowedError — a silent reset looks like a dead button.
  it('shows the retry line when the passkey prompt closes', async () => {
    vi.mocked(authenticateWithPasskey).mockRejectedValue(
      new DOMException('closed', 'NotAllowedError')
    )
    render(<LoginOptions />)

    await userEvent.setup().click(
      screen.getByRole('button', { name: /passkey/i })
    )

    expect(
      await screen.findByText(/passkey prompt was closed/i)
    ).toBeInTheDocument()
  })
})
