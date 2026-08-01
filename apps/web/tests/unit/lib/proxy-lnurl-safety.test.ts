import { describe, expect, it } from 'vitest'
import {
  createPinnedLookup,
  fetchDestinationMetadata,
  isPrivateNetworkAddress
} from '@/lib/proxy/lnurl'

describe('proxy LNURL network safety', () => {
  it('classifies private, link-local, carrier, and mapped addresses', () => {
    expect(isPrivateNetworkAddress('127.0.0.1')).toBe(true)
    expect(isPrivateNetworkAddress('10.2.3.4')).toBe(true)
    expect(isPrivateNetworkAddress('100.64.1.2')).toBe(true)
    expect(isPrivateNetworkAddress('169.254.1.2')).toBe(true)
    expect(isPrivateNetworkAddress('::1')).toBe(true)
    expect(isPrivateNetworkAddress('::ffff:192.168.1.2')).toBe(true)
    expect(isPrivateNetworkAddress('1.1.1.1')).toBe(false)
  })

  it('rejects a same-instance target before resolving DNS', async () => {
    await expect(
      fetchDestinationMetadata('alice@lawallet.example', {
        blockedHosts: ['lawallet.example']
      })
    ).rejects.toThrow(/this LaWallet instance/)
  })

  it('returns an address array when Node requests all lookup results', async () => {
    const lookup = createPinnedLookup({ address: '1.1.1.1', family: 4 })

    const result = await new Promise<{
      address: string | Array<{ address: string; family: number }>
      family?: number
    }>((resolve, reject) => {
      lookup('destination.example', { all: true }, (error, address, family) => {
        if (error) reject(error)
        else resolve({ address, family })
      })
    })

    expect(result).toEqual({
      address: [{ address: '1.1.1.1', family: 4 }],
      family: undefined
    })
  })

  it('returns one address for the classic lookup callback', async () => {
    const lookup = createPinnedLookup({ address: '1.1.1.1', family: 4 })

    const result = await new Promise<{
      address: string | Array<{ address: string; family: number }>
      family?: number
    }>((resolve, reject) => {
      lookup('destination.example', {}, (error, address, family) => {
        if (error) reject(error)
        else resolve({ address, family })
      })
    })

    expect(result).toEqual({ address: '1.1.1.1', family: 4 })
  })
})
