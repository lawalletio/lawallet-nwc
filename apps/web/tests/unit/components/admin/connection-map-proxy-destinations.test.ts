import { describe, expect, it } from 'vitest'
import {
  buildGraph,
  computeHighlight
} from '@/components/admin/connection-map/connection-map'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'

const wallet: RemoteWalletData = {
  id: 'wallet-1',
  name: 'Proxy wallet',
  type: 'NWC',
  status: 'ACTIVE',
  isDefault: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  diedAt: null,
  provider: null,
  lncurlServerUrl: null
}

const proxyAddress: WalletAddress = {
  username: 'proxy',
  mode: 'PROXY_ALIAS',
  redirect: 'alice@example.com',
  remoteWalletId: null,
  remoteWalletName: null,
  isPrimary: false,
  nwcMode: 'NONE',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

describe('Connection Map proxy destinations', () => {
  it('deduplicates shared destinations and connects address and wallet proxies', () => {
    const graph = buildGraph({
      wallets: [wallet],
      addresses: [proxyAddress],
      cards: null,
      forwardingActions: [
        {
          walletId: wallet.id,
          enabled: true,
          destinations: [
            { address: 'alice@example.com', allocationBps: 10_000 }
          ]
        }
      ],
      defaultWallet: null,
      domain: 'lawallet.example',
      lncurlEnabled: false
    })

    expect(
      graph.nodes.filter(node => node.type === 'proxy-destination')
    ).toHaveLength(1)
    expect(
      graph.nodes.find(node => node.id === 'header:proxy-destinations')?.data
    ).toEqual({ label: 'Proxied destinations' })
    expect(
      graph.nodes.find(node => node.id === 'wallet:wallet-1')?.data
    ).toMatchObject({
      isProxy: true,
      proxyEnabled: true
    })
    expect(
      graph.edges.filter(edge => edge.id.startsWith('e:proxy-'))
    ).toHaveLength(2)
  })

  it('omits the section when no proxy route is configured', () => {
    const graph = buildGraph({
      wallets: [wallet],
      addresses: [],
      cards: null,
      forwardingActions: [],
      defaultWallet: null,
      domain: 'lawallet.example',
      lncurlEnabled: false
    })

    expect(
      graph.nodes.some(node => node.id === 'header:proxy-destinations')
    ).toBe(false)
  })

  it('stops at wallet destinations and excludes routes owned by other wallets', () => {
    const secondWallet = { ...wallet, id: 'wallet-2', name: 'Other wallet' }
    const graph = buildGraph({
      wallets: [wallet, secondWallet],
      addresses: [],
      cards: null,
      forwardingActions: [
        {
          walletId: wallet.id,
          enabled: true,
          destinations: [
            { address: 'alpha@example.com', allocationBps: 5_000 },
            { address: 'shared@example.com', allocationBps: 5_000 }
          ]
        },
        {
          walletId: secondWallet.id,
          enabled: true,
          destinations: [
            { address: 'beta@example.com', allocationBps: 5_000 },
            { address: 'shared@example.com', allocationBps: 5_000 }
          ]
        }
      ],
      defaultWallet: null,
      domain: 'lawallet.example',
      lncurlEnabled: false
    })

    const highlight = computeHighlight(
      { kind: 'node', id: `wallet:${wallet.id}` },
      graph.edges
    )

    expect(highlight?.nodes).toEqual(
      new Set([
        `wallet:${wallet.id}`,
        'destination:alpha%40example.com',
        'destination:shared%40example.com'
      ])
    )
    expect(highlight?.nodes.has(`wallet:${secondWallet.id}`)).toBe(false)
    expect(highlight?.nodes.has('destination:beta%40example.com')).toBe(false)
    expect(
      highlight?.edges.has('e:proxy-wallet:wallet-2->shared%40example.com')
    ).toBe(false)
  })

  it('traces a hovered destination back only to wallets that forward to it', () => {
    const secondWallet = { ...wallet, id: 'wallet-2', name: 'Other wallet' }
    const graph = buildGraph({
      wallets: [wallet, secondWallet],
      addresses: [],
      cards: null,
      forwardingActions: [
        {
          walletId: wallet.id,
          enabled: true,
          destinations: [
            { address: 'lacrypta@example.com', allocationBps: 5_000 },
            { address: 'shared@example.com', allocationBps: 5_000 }
          ]
        },
        {
          walletId: secondWallet.id,
          enabled: true,
          destinations: [
            { address: 'primal@example.com', allocationBps: 5_000 },
            { address: 'shared@example.com', allocationBps: 5_000 }
          ]
        }
      ],
      defaultWallet: null,
      domain: 'lawallet.example',
      lncurlEnabled: false
    })

    const highlight = computeHighlight(
      { kind: 'node', id: 'destination:lacrypta%40example.com' },
      graph.edges
    )

    expect(highlight?.nodes).toEqual(
      new Set(['destination:lacrypta%40example.com', `wallet:${wallet.id}`])
    )
    expect(highlight?.edges).toEqual(
      new Set(['e:proxy-wallet:wallet-1->lacrypta%40example.com'])
    )
    expect(highlight?.nodes.has(`wallet:${secondWallet.id}`)).toBe(false)
    expect(highlight?.nodes.has('destination:shared%40example.com')).toBe(false)
  })

  it('lights every wallet that shares the hovered destination', () => {
    const secondWallet = { ...wallet, id: 'wallet-2', name: 'Other wallet' }
    const graph = buildGraph({
      wallets: [wallet, secondWallet],
      addresses: [],
      cards: null,
      forwardingActions: [
        {
          walletId: wallet.id,
          enabled: true,
          destinations: [
            { address: 'shared@example.com', allocationBps: 10_000 }
          ]
        },
        {
          walletId: secondWallet.id,
          enabled: true,
          destinations: [
            { address: 'shared@example.com', allocationBps: 10_000 }
          ]
        }
      ],
      defaultWallet: null,
      domain: 'lawallet.example',
      lncurlEnabled: false
    })

    const highlight = computeHighlight(
      { kind: 'node', id: 'destination:shared%40example.com' },
      graph.edges
    )

    expect(highlight?.nodes).toEqual(
      new Set([
        'destination:shared%40example.com',
        `wallet:${wallet.id}`,
        `wallet:${secondWallet.id}`
      ])
    )
    expect(highlight?.edges).toEqual(
      new Set([
        'e:proxy-wallet:wallet-1->shared%40example.com',
        'e:proxy-wallet:wallet-2->shared%40example.com'
      ])
    )
  })
})
