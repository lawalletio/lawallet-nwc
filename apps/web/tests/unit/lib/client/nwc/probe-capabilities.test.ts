import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getInfo, getNwcClient, closeNwcClient } = vi.hoisted(() => ({
  getInfo: vi.fn(),
  getNwcClient: vi.fn(),
  closeNwcClient: vi.fn()
}))

vi.mock('@/lib/client/nwc/nwc-client', () => ({
  getNwcClient,
  closeNwcClient
}))

import {
  deriveNwcCapabilities,
  nwcCapabilityKind,
  probeNwcCapabilities
} from '@/lib/client/nwc/probe-capabilities'

const NWC = 'nostr+walletconnect://abc'

beforeEach(() => {
  getInfo.mockReset()
  getNwcClient.mockReset()
  closeNwcClient.mockReset()
  getNwcClient.mockResolvedValue({ getInfo })
})

describe('deriveNwcCapabilities', () => {
  it('maps make_invoice + pay_invoice to send-and-receive', () => {
    const caps = deriveNwcCapabilities({
      alias: 'Alby Hub',
      methods: ['get_info', 'make_invoice', 'pay_invoice']
    })
    expect(caps).toEqual({
      alias: 'Alby Hub',
      methods: ['get_info', 'make_invoice', 'pay_invoice'],
      canReceive: true,
      canSend: true,
      mode: 'SEND_RECEIVE'
    })
    expect(nwcCapabilityKind(caps)).toBe('SEND_RECEIVE')
  })

  it('maps make_invoice without pay_invoice to receive-only', () => {
    const caps = deriveNwcCapabilities({
      methods: ['get_info', 'make_invoice']
    })
    expect(caps.canReceive).toBe(true)
    expect(caps.canSend).toBe(false)
    expect(caps.mode).toBe('RECEIVE')
    expect(nwcCapabilityKind(caps)).toBe('RECEIVE')
  })

  it('does not treat a view-only pairing as receive-capable', () => {
    const caps = deriveNwcCapabilities({
      alias: 'Watch-only',
      methods: ['get_info', 'get_balance']
    })
    expect(caps.canReceive).toBe(false)
    expect(caps.canSend).toBe(false)
    // Persisted mode stays the two-value enum; canReceive is the flag.
    expect(caps.mode).toBe('RECEIVE')
    expect(nwcCapabilityKind(caps)).toBe('VIEW_ONLY')
  })

  it('maps pay_invoice without make_invoice to send-only', () => {
    const caps = deriveNwcCapabilities({
      methods: ['get_info', 'pay_invoice']
    })
    expect(caps.canReceive).toBe(false)
    expect(caps.canSend).toBe(true)
    expect(caps.mode).toBe('SEND_RECEIVE')
    expect(nwcCapabilityKind(caps)).toBe('SEND_ONLY')
  })

  it('treats missing methods as view-only', () => {
    const caps = deriveNwcCapabilities({ methods: 'not-an-array' })
    expect(caps.methods).toEqual([])
    expect(caps.canReceive).toBe(false)
    expect(caps.alias).toBeNull()
    expect(nwcCapabilityKind(caps)).toBe('VIEW_ONLY')
  })
})

describe('probeNwcCapabilities', () => {
  it('derives capabilities from get_info and closes the client', async () => {
    getInfo.mockResolvedValue({
      alias: 'Phoenix',
      methods: ['make_invoice']
    })

    const caps = await probeNwcCapabilities(NWC)

    expect(getNwcClient).toHaveBeenCalledWith(NWC)
    expect(caps.canReceive).toBe(true)
    expect(caps.mode).toBe('RECEIVE')
    expect(closeNwcClient).toHaveBeenCalledWith(NWC)
  })

  it('still closes the client when get_info fails', async () => {
    getInfo.mockRejectedValue(new Error('relay down'))
    await expect(probeNwcCapabilities(NWC)).rejects.toThrow('relay down')
    expect(closeNwcClient).toHaveBeenCalledWith(NWC)
  })
})
