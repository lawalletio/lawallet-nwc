import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import {
  NostrProfileProvider,
  useNostrProfiles,
} from '@/lib/client/nostr-profile'

// The provider dynamically imports SimplePool from nostr-tools/pool; mock it so
// no real relay traffic happens and we control what kind-0 events come back.
const { querySyncMock } = vi.hoisted(() => ({ querySyncMock: vi.fn() }))
vi.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    querySync = querySyncMock
    get = vi.fn()
    close = vi.fn()
  },
}))

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)

function kind0(pubkey: string, created_at: number, meta: Record<string, unknown>) {
  return { pubkey, created_at, kind: 0, content: JSON.stringify(meta) }
}

function Probe({ pubkeys }: { pubkeys: string[] }) {
  const { profiles, loading } = useNostrProfiles(pubkeys)
  return (
    <div data-testid="out" data-loading={loading}>
      {JSON.stringify(
        Object.fromEntries(
          Object.entries(profiles).map(([pk, p]) => [pk, p?.name ?? null]),
        ),
      )}
    </div>
  )
}

function renderProbe(pubkeys: string[]) {
  return render(
    <NostrProfileProvider>
      <Probe pubkeys={pubkeys} />
    </NostrProfileProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  querySyncMock.mockReset()
})

describe('useNostrProfiles', () => {
  it('resolves many pubkeys in one batched query', async () => {
    querySyncMock.mockResolvedValue([
      kind0(PK_A, 100, { name: 'alice', picture: 'https://x/a.png' }),
      kind0(PK_B, 100, { name: 'bob' }),
    ])

    renderProbe([PK_A, PK_B])

    await waitFor(() => {
      const out = JSON.parse(screen.getByTestId('out').textContent || '{}')
      expect(out[PK_A]).toBe('alice')
      expect(out[PK_B]).toBe('bob')
    })
    // A single relay round-trip for the whole list.
    expect(querySyncMock).toHaveBeenCalledTimes(1)
    expect(querySyncMock.mock.calls[0][1]).toMatchObject({
      kinds: [0],
      authors: expect.arrayContaining([PK_A, PK_B]),
    })
  })

  it('keeps the latest event per author', async () => {
    querySyncMock.mockResolvedValue([
      kind0(PK_A, 100, { name: 'old-name' }),
      kind0(PK_A, 200, { name: 'new-name' }),
    ])

    renderProbe([PK_A])

    await waitFor(() => {
      const out = JSON.parse(screen.getByTestId('out').textContent || '{}')
      expect(out[PK_A]).toBe('new-name')
    })
  })

  it('serves from cache on a later mount without re-querying', async () => {
    querySyncMock.mockResolvedValue([kind0(PK_A, 100, { name: 'alice' })])

    const first = renderProbe([PK_A])
    await waitFor(() => {
      const out = JSON.parse(screen.getByTestId('out').textContent || '{}')
      expect(out[PK_A]).toBe('alice')
    })
    first.unmount()

    // Fresh provider instance: it should hydrate from localStorage and skip the relay.
    querySyncMock.mockClear()
    renderProbe([PK_A])

    await waitFor(() => {
      const out = JSON.parse(screen.getByTestId('out').textContent || '{}')
      expect(out[PK_A]).toBe('alice')
    })
    expect(querySyncMock).not.toHaveBeenCalled()
  })

  it('throws when used outside the provider', () => {
    // Silence the expected React error boundary console noise.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe pubkeys={[PK_A]} />)).toThrow(
      /must be used within a NostrProfileProvider/,
    )
    spy.mockRestore()
  })
})
