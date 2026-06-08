import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { nip19 } from 'nostr-tools'

// Mock the data sources so the component renders without real API/relay calls.
vi.mock('@/lib/client/hooks/use-users', () => ({
  useUsers: vi.fn(),
}))
vi.mock('@/lib/client/nostr-profile', () => ({
  useNostrProfiles: vi.fn(),
}))

import { UserSelector } from '@/components/admin/user-selector'
import { useUsers } from '@/lib/client/hooks/use-users'
import { useNostrProfiles } from '@/lib/client/nostr-profile'

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)

const USERS = [
  {
    id: 'user_a',
    pubkey: PK_A,
    role: 'ADMIN',
    createdAt: '2026-01-01T00:00:00.000Z',
    primaryAddress: 'alice',
    addressCount: 1,
    hasNwc: false,
  },
  {
    id: 'user_b',
    pubkey: PK_B,
    role: 'OPERATOR',
    createdAt: '2026-01-01T00:00:00.000Z',
    primaryAddress: null,
    addressCount: 0,
    hasNwc: false,
  },
]

function mockData() {
  vi.mocked(useUsers).mockReturnValue({ data: USERS, loading: false } as any)
  vi.mocked(useNostrProfiles).mockReturnValue({
    profiles: {
      [PK_A]: {
        pubkey: PK_A,
        name: 'alice',
        displayName: 'Alice',
        picture: 'https://x/a.png',
        fetchedAt: Date.now(),
      },
      [PK_B]: null,
    },
    loading: false,
  } as any)
}

function Harness() {
  const [value, setValue] = useState('')
  return (
    <>
      <div data-testid="value">{value}</div>
      <UserSelector value={value} onValueChange={setValue} />
    </>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockData()
})

describe('UserSelector', () => {
  it('renders the placeholder when nothing is selected', () => {
    render(<Harness />)
    expect(screen.getByText('Select a user')).toBeInTheDocument()
  })

  it('lists users with names and role badges, and selects on click', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('combobox'))

    // Alice resolves a display name from the profile cache; both roles render.
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    expect(screen.getByText('ADMIN')).toBeInTheDocument()
    expect(screen.getByText('OPERATOR')).toBeInTheDocument()

    await user.click(screen.getByText('Alice'))
    expect(screen.getByTestId('value').textContent).toBe('user_a')
  })

  it('uses the first two npub characters as the avatar fallback', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('combobox'))

    // Bob (PK_B) has no profile picture, so the fallback initials show.
    const expected = nip19.npubEncode(PK_B).slice(5, 7).toUpperCase()
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('clears the selection with the clear (x) button', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    // Select Alice.
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByText('Alice'))
    expect(screen.getByTestId('value').textContent).toBe('user_a')

    // The clear button appears only once something is selected.
    await user.click(screen.getByRole('button', { name: /clear selection/i }))
    expect(screen.getByTestId('value').textContent).toBe('')
    expect(screen.getByText('Select a user')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /clear selection/i }),
    ).not.toBeInTheDocument()
  })

  it('filters the list by the search input', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('combobox'))
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('Search users…'), 'alice')

    // The non-matching OPERATOR row drops out of the filtered list.
    await waitFor(() =>
      expect(screen.queryByText('OPERATOR')).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })
})
