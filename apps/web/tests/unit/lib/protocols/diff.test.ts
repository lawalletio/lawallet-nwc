import { describe, expect, it } from 'vitest'
import { summarizeProtocolScan } from '@/lib/protocols/diff'

const unknown = {
  lud16: null,
  nip05: true,
  lud21: null,
  nip57: null,
  lud12: null
}

const probed = {
  lud16: true,
  nip05: true,
  lud21: false,
  nip57: true,
  lud12: false
}

describe('summarizeProtocolScan', () => {
  it('counts an unprobed alias as fixed once protocols become known', () => {
    const summary = summarizeProtocolScan([
      {
        username: 'misscons',
        error: null,
        previous: { protocols: unknown },
        protocols: { protocols: probed }
      },
      {
        username: 'alice',
        error: null,
        previous: { protocols: probed },
        protocols: { protocols: probed }
      }
    ])

    expect(summary.scanned).toBe(2)
    expect(summary.fixed).toBe(1)
    expect(summary.changed).toBe(1)
    expect(summary.failed).toBe(0)
    expect(summary.fixedAddresses.map(a => a.username)).toEqual(['misscons'])
    expect(summary.byProtocol.lud16).toEqual({
      newlyValid: 1,
      newlyKnown: 1,
      lost: 0
    })
    expect(summary.byProtocol.lud21).toEqual({
      newlyValid: 0,
      newlyKnown: 1,
      lost: 0
    })
  })

  it('counts a lost capability separately from a fix', () => {
    const summary = summarizeProtocolScan([
      {
        username: 'bob',
        error: null,
        previous: { protocols: { ...probed, nip57: true } },
        protocols: { protocols: { ...probed, nip57: false } }
      }
    ])

    expect(summary.fixed).toBe(0)
    expect(summary.changed).toBe(1)
    expect(summary.byProtocol.nip57.lost).toBe(1)
  })
})
