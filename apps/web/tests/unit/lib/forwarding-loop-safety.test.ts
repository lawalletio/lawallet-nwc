import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@/lib/public-url', () => ({
  resolvePublicEndpoint: vi.fn(async () => ({
    host: 'pay.example.com',
    url: 'https://pay.example.com'
  })),
  resolveApiUrl: vi.fn(async () => 'https://app.example.com')
}))

import {
  assertNoForwardingCycle,
  forwardingGraphNodes
} from '@/lib/proxy/forwarding-graph'
import { resolveLocalDestination } from '@/lib/proxy/local-destination'
import {
  MAX_FORWARD_HOPS,
  getForwardDepth,
  isForwardDepthExhausted,
  recordForwardHop
} from '@/lib/proxy/forward-hops'

/** Address rows keyed by username, fed to the graph walk. */
function addresses(rows: Record<string, unknown>) {
  vi.mocked(prismaMock.lightningAddress.findUnique).mockImplementation(
    (async ({ where }: any) => rows[where.username] ?? null) as never
  )
}

/** Wallets keyed by id → their enabled FORWARD destinations. */
function wallets(rows: Record<string, string[]>) {
  vi.mocked(
    prismaMock.remoteWalletReceiveAction.findUnique
  ).mockImplementation((async ({ where }: any) => {
    const destinations = rows[where.remoteWalletId]
    if (!destinations) return null
    return {
      enabled: true,
      currentRevision: {
        destinations: destinations.map(address => ({ address }))
      }
    }
  }) as never)
}

beforeEach(() => {
  resetPrismaMock()
  addresses({})
  wallets({})
})

describe('local destination detection', () => {
  it('recognises both the public host and the api host as local', async () => {
    expect(await resolveLocalDestination('mita1@pay.example.com')).toEqual({
      username: 'mita1',
      origin: 'https://app.example.com'
    })
    expect(await resolveLocalDestination('mita1@app.example.com')).not.toBeNull()
  })

  it('treats another service as remote', async () => {
    expect(await resolveLocalDestination('bob@other.com')).toBeNull()
  })
})

describe('config-time cycle detection', () => {
  it('allows a plain local destination — the point of the feature', async () => {
    addresses({ mita1: { mode: 'DEFAULT_NWC', redirect: null } })
    await expect(
      assertNoForwardingCycle(
        forwardingGraphNodes.wallet('wallet-1'),
        'mita1@pay.example.com'
      )
    ).resolves.toBeUndefined()
  })

  it('allows any destination on another service', async () => {
    await expect(
      assertNoForwardingCycle(
        forwardingGraphNodes.address('alice'),
        'bob@other.com'
      )
    ).resolves.toBeUndefined()
  })

  it('rejects an address forwarding to itself', async () => {
    await expect(
      assertNoForwardingCycle(
        forwardingGraphNodes.address('alice'),
        'alice@pay.example.com'
      )
    ).rejects.toThrow(/loop back to itself/)
  })

  it('rejects a two-address PROXY_ALIAS ping-pong', async () => {
    // alice -> bob, and bob already points back at alice.
    addresses({
      bob: {
        mode: 'PROXY_ALIAS',
        redirect: 'alice@pay.example.com',
        remoteWalletId: null
      },
      alice: { mode: 'DEFAULT_NWC', redirect: null, remoteWalletId: null }
    })
    await expect(
      assertNoForwardingCycle(
        forwardingGraphNodes.address('alice'),
        'bob@pay.example.com'
      )
    ).rejects.toThrow(/payment loop/)
  })

  it('rejects a ring that crosses the proxy and wallet subsystems', async () => {
    // wallet-1 -> carol@local, carol is bound to wallet-1. A hop counter in one
    // subsystem alone would not see this.
    addresses({
      carol: {
        mode: 'CUSTOM_NWC',
        redirect: null,
        remoteWalletId: 'wallet-1'
      }
    })
    await expect(
      assertNoForwardingCycle(
        forwardingGraphNodes.wallet('wallet-1'),
        'carol@pay.example.com'
      )
    ).rejects.toThrow(/payment loop/)
  })

  it('terminates on a cycle that does not involve the origin', async () => {
    // bob <-> carol loop, origin alice is not part of it: must not hang.
    addresses({
      bob: {
        mode: 'PROXY_ALIAS',
        redirect: 'carol@pay.example.com',
        remoteWalletId: null
      },
      carol: {
        mode: 'PROXY_ALIAS',
        redirect: 'bob@pay.example.com',
        remoteWalletId: null
      }
    })
    await expect(
      assertNoForwardingCycle(
        forwardingGraphNodes.address('alice'),
        'bob@pay.example.com'
      )
    ).resolves.toBeUndefined()
  })

  it('ignores ALIAS redirects — they move no money', async () => {
    addresses({
      bob: {
        mode: 'ALIAS',
        redirect: 'alice@pay.example.com',
        remoteWalletId: null
      }
    })
    await expect(
      assertNoForwardingCycle(
        forwardingGraphNodes.address('alice'),
        'bob@pay.example.com'
      )
    ).resolves.toBeUndefined()
  })
})

describe('local destination transport', () => {
  const payRequest = {
    status: 'OK',
    tag: 'payRequest',
    callback: 'https://app.example.com/api/lud16/mita1/cb',
    minSendable: 1000,
    maxSendable: 100_000_000,
    metadata: '[["text/identifier","mita1@pay.example.com"]]',
    // LUD-21: must survive a verbatim passthrough.
    verify: 'https://app.example.com/api/lud16/mita1/verify'
  }

  it('resolves a local destination over our own origin, not its public host', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payRequest), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    try {
      const { fetchDestinationMetadata } = await import('@/lib/proxy/lnurl')
      const metadata = await fetchDestinationMetadata(
        'mita1@pay.example.com',
        // Deliberately passes the self-blocking list the callers still send:
        // a local destination must no longer be refused by it.
        { blockedHosts: ['pay.example.com', 'app.example.com'] }
      )
      expect(metadata.callback).toBe(payRequest.callback)
      const requested = String(vi.mocked(fetchMock).mock.calls[0]?.[0])
      expect(requested).toBe('https://app.example.com/api/lud16/mita1')
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('proxies a payRequest verbatim so LUD-21 verify survives', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payRequest), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    try {
      const { fetchDestinationPayRequest } = await import('@/lib/proxy/lnurl')
      const raw = (await fetchDestinationPayRequest(
        'mita1@pay.example.com'
      )) as Record<string, unknown>
      expect(raw.verify).toBe(payRequest.verify)
    } finally {
      fetchMock.mockRestore()
    }
  })
})

describe('runtime hop counter', () => {
  it('starts at zero for a payment that never came from a local forward', async () => {
    vi.mocked(prismaMock.forwardingHop.findUnique).mockResolvedValue(
      null as never
    )
    expect(await getForwardDepth('ab'.repeat(32))).toBe(0)
    expect(await getForwardDepth(null)).toBe(0)
  })

  it('stops exactly at the limit', async () => {
    expect(isForwardDepthExhausted(MAX_FORWARD_HOPS - 1)).toBe(false)
    expect(isForwardDepthExhausted(MAX_FORWARD_HOPS)).toBe(true)
  })

  it('reads the recorded depth of the funding payment', async () => {
    vi.mocked(prismaMock.forwardingHop.findUnique).mockResolvedValue({
      depth: 2
    } as never)
    expect(await getForwardDepth('cd'.repeat(32))).toBe(2)
  })

  it('never fails a payment because the marker could not be written', async () => {
    vi.mocked(prismaMock.forwardingHop.upsert).mockRejectedValue(
      new Error('db down') as never
    )
    await expect(
      recordForwardHop('ef'.repeat(32), 1)
    ).resolves.toBeUndefined()
  })
})
