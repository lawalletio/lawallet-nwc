import { describe, it, expect } from 'vitest'
import {
  isTerminalVoucherStatus,
  nextVoucherStatus,
  voucherStatusFromService
} from '@/lib/vouchers/transition'
import type { VoucherStatus } from '@/lib/validation/schemas'

const ALL: VoucherStatus[] = ['MINTED', 'CLAIMED', 'EXPIRED', 'VOIDED']

describe('voucherStatusFromService', () => {
  it('maps every wire status onto the enum', () => {
    expect(voucherStatusFromService('minted')).toBe('MINTED')
    expect(voucherStatusFromService('claimed')).toBe('CLAIMED')
    expect(voucherStatusFromService('expired')).toBe('EXPIRED')
    expect(voucherStatusFromService('voided')).toBe('VOIDED')
  })
})

describe('isTerminalVoucherStatus', () => {
  it('treats a burned coupon as absorbing and a live one as not', () => {
    expect(isTerminalVoucherStatus('CLAIMED')).toBe(true)
    expect(isTerminalVoucherStatus('VOIDED')).toBe(true)
    expect(isTerminalVoucherStatus('MINTED')).toBe(false)
    // Deliberately not terminal: a coupon claimed just before expiry can be
    // reported late, and the claim is the more meaningful fact.
    expect(isTerminalVoucherStatus('EXPIRED')).toBe(false)
  })
})

describe('nextVoucherStatus', () => {
  it('never leaves a terminal status, whatever the service reports', () => {
    for (const current of ['CLAIMED', 'VOIDED'] as VoucherStatus[]) {
      for (const reported of ALL) {
        expect(nextVoucherStatus(current, reported)).toBe(current)
      }
    }
  })

  it('accepts any report from a non-terminal status', () => {
    for (const current of ['MINTED', 'EXPIRED'] as VoucherStatus[]) {
      for (const reported of ALL) {
        expect(nextVoucherStatus(current, reported)).toBe(reported)
      }
    }
  })

  it('does not un-burn a claimed voucher when a service reports minted', () => {
    expect(nextVoucherStatus('CLAIMED', 'MINTED')).toBe('CLAIMED')
  })
})
