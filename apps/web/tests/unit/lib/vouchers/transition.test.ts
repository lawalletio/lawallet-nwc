import { describe, it, expect } from 'vitest'
import {
  isTerminalVoucherStatus,
  nextVoucherStatus,
  voucherStatusFromService
} from '@/lib/vouchers/transition'
import type { VoucherStatus } from '@/lib/validation/schemas'

const ALL: VoucherStatus[] = [
  'MINTED',
  'TRANSFER_PENDING',
  'TRANSFERRED',
  'CLAIMED',
  'EXPIRED',
  'VOIDED'
]

describe('voucherStatusFromService', () => {
  it('maps every wire status onto the enum', () => {
    expect(voucherStatusFromService('minted')).toBe('MINTED')
    expect(voucherStatusFromService('claimed')).toBe('CLAIMED')
    expect(voucherStatusFromService('expired')).toBe('EXPIRED')
    expect(voucherStatusFromService('voided')).toBe('VOIDED')
    // The nonce was swapped away — from this row's side that is a transfer.
    expect(voucherStatusFromService('refreshed')).toBe('TRANSFERRED')
  })

  it('returns null for a vocabulary this build does not know', () => {
    // Services may grow new statuses. Guessing is worse than admitting
    // ignorance: the caller leaves the stored status untouched. A throw here
    // would break status refresh against every *newer* service.
    expect(voucherStatusFromService('quantum-superposed')).toBeNull()
    expect(voucherStatusFromService(undefined)).toBeNull()
    expect(voucherStatusFromService(null)).toBeNull()
  })
})

describe('isTerminalVoucherStatus', () => {
  it('treats a burned coupon as absorbing and a live one as not', () => {
    expect(isTerminalVoucherStatus('CLAIMED')).toBe(true)
    expect(isTerminalVoucherStatus('VOIDED')).toBe(true)
    expect(isTerminalVoucherStatus('TRANSFERRED')).toBe(true)
    expect(isTerminalVoucherStatus('MINTED')).toBe(false)
    // In-flight, not settled — settling it is the whole point.
    expect(isTerminalVoucherStatus('TRANSFER_PENDING')).toBe(false)
    // Deliberately not terminal: a coupon claimed just before expiry can be
    // reported late, and the claim is the more meaningful fact.
    expect(isTerminalVoucherStatus('EXPIRED')).toBe(false)
  })
})

describe('nextVoucherStatus', () => {
  it('never leaves a terminal status, whatever the service reports', () => {
    for (const current of [
      'CLAIMED',
      'VOIDED',
      'TRANSFERRED'
    ] as VoucherStatus[]) {
      for (const reported of ALL) {
        expect(nextVoucherStatus(current, reported)).toBe(current)
      }
    }
  })

  it('accepts any report from a non-terminal status', () => {
    for (const current of [
      'MINTED',
      'EXPIRED',
      'TRANSFER_PENDING'
    ] as VoucherStatus[]) {
      for (const reported of ALL) {
        expect(nextVoucherStatus(current, reported)).toBe(reported)
      }
    }
  })

  it('does not un-burn a claimed voucher when a service reports minted', () => {
    expect(nextVoucherStatus('CLAIMED', 'MINTED')).toBe('CLAIMED')
  })

  it('does not un-send a transferred voucher', () => {
    // The nonce on this row was burned by the recipient's refresh. Nothing
    // the service says can make it spendable here again.
    expect(nextVoucherStatus('TRANSFERRED', 'MINTED')).toBe('TRANSFERRED')
  })

  it('lets an in-flight transfer settle either way', () => {
    expect(nextVoucherStatus('TRANSFER_PENDING', 'MINTED')).toBe('MINTED')
    expect(nextVoucherStatus('TRANSFER_PENDING', 'TRANSFERRED')).toBe(
      'TRANSFERRED'
    )
  })
})
