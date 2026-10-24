import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { finalizeEvent } from 'nostr-tools/pure'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  close: vi.fn(),
  update: vi.fn()
}))
vi.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    querySync = mocks.query
    close = mocks.close
  }
}))
vi.mock('@/lib/client/nostr-profile', async original => ({
  ...(await original<typeof import('@/lib/client/nostr-profile')>()),
  useNostrProfile: () => ({ profile: null, updateProfile: mocks.update })
}))
import { PasskeyAccountPreview } from '@/components/shared/passkey-account-preview'

const event = finalizeEvent(
  {
    kind: 0,
    created_at: 1,
    tags: [],
    content: JSON.stringify({
      name: 'Alice',
      picture: 'https://example.com/alice.png'
    })
  },
  new Uint8Array(32).fill(1)
)
beforeEach(() => {
  vi.clearAllMocks()
})

describe('passkey identity preview', () => {
  it('loads verified public metadata before login and closes the relay connections', async () => {
    mocks.query.mockResolvedValue([event])
    render(<PasskeyAccountPreview pubkey={event.pubkey} />)
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ pubkey: event.pubkey, name: 'Alice' })
      )
    )
    expect(mocks.close).toHaveBeenCalled()
    expect(screen.getByTestId('passkey-import-npub')).toHaveTextContent(
      /^npub1/
    )
  })
  it('does not cache a profile with an invalid signature', async () => {
    mocks.query.mockResolvedValue([{ ...JSON.parse(JSON.stringify(event)), sig: '0'.repeat(128) }])
    render(<PasskeyAccountPreview pubkey={event.pubkey} />)
    await waitFor(() => expect(mocks.close).toHaveBeenCalled())
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('keeps the public key visible if profile lookup fails', async () => {
    mocks.query.mockRejectedValue(new Error('offline'))
    render(<PasskeyAccountPreview pubkey={event.pubkey} />)
    await waitFor(() => expect(mocks.close).toHaveBeenCalled())
    expect(screen.getByTestId('passkey-import-npub')).toHaveTextContent(
      /^npub1/
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
