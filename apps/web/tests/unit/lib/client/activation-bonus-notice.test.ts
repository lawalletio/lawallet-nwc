import { describe, it, expect, beforeEach } from 'vitest'
import {
  readActivationBonus,
  rememberActivationBonus,
  rememberGrantedActivationBonus,
  resetActivationBonusForTests,
  takeActivationBonus
} from '@/lib/client/activation-bonus-notice'

beforeEach(() => {
  sessionStorage.clear()
  resetActivationBonusForTests()
})

describe('activation bonus notice', () => {
  it('stores a granted amount and lets the home screen consume it once', () => {
    expect(
      rememberGrantedActivationBonus({
        sats: { granted: true, amountSats: 2100 }
      })
    ).toBe(2100)
    expect(readActivationBonus()).toBe(2100)
    expect(takeActivationBonus()).toBe(2100)
    expect(readActivationBonus()).toBeNull()
    expect(takeActivationBonus()).toBeNull()
  })

  it('stores nothing when the bonus is disabled or the payment did not land', () => {
    expect(rememberGrantedActivationBonus(null)).toBeNull()
    expect(
      rememberGrantedActivationBonus({
        sats: { granted: false, amountSats: 500 }
      })
    ).toBeNull()
    expect(
      rememberGrantedActivationBonus({ sats: { granted: true, amountSats: 0 } })
    ).toBeNull()
    expect(
      rememberGrantedActivationBonus({ sats: { granted: true } })
    ).toBeNull()
    expect(readActivationBonus()).toBeNull()
  })

  it('ignores a non-positive remember call', () => {
    rememberActivationBonus(0)
    rememberActivationBonus(Number.NaN)
    expect(readActivationBonus()).toBeNull()
  })

  it('keeps the amount in memory when sessionStorage is blocked', () => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      rememberActivationBonus(1000)
      expect(readActivationBonus()).toBe(1000)
    } finally {
      Storage.prototype.setItem = setItem
    }
  })
})
