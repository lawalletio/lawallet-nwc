import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { __resetContactsCacheForTests } from '@/lib/client/contacts-store'
import { RecipientInput } from '@/components/wallet/send/recipient-input'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('@/lib/client/hooks/use-api', () => ({
  useApi: () => ({ data: { lightningAddress: 'me@lawallet.io' } })
}))

function seedContacts(count: number) {
  const contacts = Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    name: `user${i}`,
    lightningAddress: `user${i}@lawallet.io`,
    createdAt: 1000 - i
  }))
  window.localStorage.setItem('lawallet-contacts', JSON.stringify(contacts))
  __resetContactsCacheForTests()
}

describe('RecipientInput', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetContactsCacheForTests()
    // The list hydrates NIP-05 profiles on mount — keep it off the network.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    )
  })

  it('disables native browser autocomplete', () => {
    render(<RecipientInput />)
    expect(screen.getByRole('combobox')).toHaveAttribute('autocomplete', 'off')
  })

  it('shows at most the last 10 recipients when the input is empty', () => {
    seedContacts(12)
    render(<RecipientInput />)
    expect(screen.getByRole('group', { name: 'Saved' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(10)
  })

  it('replaces recents with typed suggestions once the user types', async () => {
    const user = userEvent.setup()
    seedContacts(12)
    render(<RecipientInput />)

    await user.type(screen.getByRole('combobox'), 'satoshi')

    expect(screen.queryByRole('group', { name: 'Saved' })).toBeNull()
    expect(
      screen.getByRole('group', { name: 'Suggestions' })
    ).toBeInTheDocument()
    for (const option of screen.getAllByRole('option')) {
      expect(option.textContent).toContain('satoshi@')
    }
  })
})
