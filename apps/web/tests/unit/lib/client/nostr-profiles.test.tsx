import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import {
  NostrProfileProvider,
  useNostrProfile,
  useNostrProfiles,
} from '@/lib/client/nostr-profile'
import { normalizeNostrPubkey } from '@/lib/nostr/profile'

const { apiPostMock } = vi.hoisted(() => ({ apiPostMock: vi.fn() }))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({
    status: 'authenticated',
    apiClient: {
      post: apiPostMock,
    },
  }),
}))

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)
const NPUB_A = normalizeNostrPubkey(PK_A)?.npub ?? 'npub-a'
const NPUB_B = normalizeNostrPubkey(PK_B)?.npub ?? 'npub-b'

function apiProfile(pubkey: string, name: string) {
  const normalized = normalizeNostrPubkey(pubkey)
  if (!normalized) throw new Error('bad pubkey')
  return {
    pubkey: normalized.pubkey,
    npub: normalized.npub,
    name,
    fetchedAt: Date.now(),
  }
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

function SingleProbe({ pubkey, force = false }: { pubkey: string; force?: boolean }) {
  const { profile, loading } = useNostrProfile(pubkey, { force })
  return (
    <div data-testid="single" data-loading={loading}>
      {profile?.name ?? 'missing'}
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
  apiPostMock.mockReset()
})

describe('useNostrProfiles', () => {
  it('resolves many pubkeys in one batched API request', async () => {
    apiPostMock.mockResolvedValue({
      profiles: [apiProfile(PK_A, 'alice'), apiProfile(PK_B, 'bob')],
    })

    renderProbe([PK_A, PK_B])

    await waitFor(() => {
      const out = JSON.parse(screen.getByTestId('out').textContent || '{}')
      expect(out[PK_A]).toBe('alice')
      expect(out[PK_B]).toBe('bob')
    })
    expect(apiPostMock).toHaveBeenCalledTimes(1)
    expect(apiPostMock).toHaveBeenCalledWith('/api/nostr/profiles', {
      pubkeys: expect.arrayContaining([PK_A, PK_B]),
      force: false,
    })
  })

  it('serves from localStorage on a later mount without re-querying', async () => {
    apiPostMock.mockResolvedValue({ profiles: [apiProfile(PK_A, 'alice')] })

    const first = renderProbe([PK_A])
    await waitFor(() => {
      const out = JSON.parse(screen.getByTestId('out').textContent || '{}')
      expect(out[PK_A]).toBe('alice')
    })
    first.unmount()

    apiPostMock.mockClear()
    renderProbe([PK_A])

    await waitFor(() => {
      const out = JSON.parse(screen.getByTestId('out').textContent || '{}')
      expect(out[PK_A]).toBe('alice')
    })
    expect(apiPostMock).not.toHaveBeenCalled()
  })

  it('force-refreshes direct profile visits even with a fresh local cache', async () => {
    window.localStorage.setItem(
      'lawallet-nostr-profiles',
      JSON.stringify({
        [PK_A]: {
          pubkey: PK_A,
          npub: NPUB_A,
          name: 'cached',
          fetchedAt: Date.now(),
        },
      }),
    )
    apiPostMock.mockResolvedValue({ profiles: [apiProfile(PK_A, 'fresh')] })

    render(
      <NostrProfileProvider>
        <SingleProbe pubkey={PK_A} force />
      </NostrProfileProvider>,
    )

    expect(screen.getByTestId('single').textContent).toBe('cached')
    await waitFor(() => {
      expect(screen.getByTestId('single').textContent).toBe('fresh')
    })
    expect(apiPostMock).toHaveBeenCalledWith('/api/nostr/profiles', {
      pubkeys: [PK_A],
      force: true,
    })
  })

  it('throws when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe pubkeys={[PK_A]} />)).toThrow(
      /must be used within a NostrProfileProvider/,
    )
    spy.mockRestore()
  })

  it('normalizes npub responses back under the hex cache key', async () => {
    apiPostMock.mockResolvedValue({
      profiles: [{ pubkey: PK_B, npub: NPUB_B, name: 'bob', fetchedAt: Date.now() }],
    })

    renderProbe([NPUB_B])

    await waitFor(() => {
      const out = JSON.parse(screen.getByTestId('out').textContent || '{}')
      expect(out[NPUB_B]).toBe('bob')
    })
  })

  it('keeps the UI stable when the profile API fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    apiPostMock.mockRejectedValue(new Error('database not ready'))

    renderProbe([PK_A])

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByTestId('out').getAttribute('data-loading')).toBe('false')
    })

    const out = JSON.parse(screen.getByTestId('out').textContent || '{}')
    expect(out[PK_A]).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      'Failed to refresh Nostr profiles from server cache',
      expect.any(Error),
    )
    warn.mockRestore()
  })
})
