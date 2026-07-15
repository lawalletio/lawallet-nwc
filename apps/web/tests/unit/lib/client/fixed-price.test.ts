import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetFixedPriceCacheForTests,
  estimateFixedPriceSats,
  isValidFixedPriceAmount,
  readFixedPrice,
  saveFixedPrice,
} from '@/lib/client/fixed-price'

describe('fixed-price store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetFixedPriceCacheForTests()
  })

  it('persists a price only for the selected address in localStorage', () => {
    saveFixedPrice('Alice', { amount: '2500', currency: 'SAT' })

    expect(readFixedPrice('alice')).toEqual({ amount: '2500', currency: 'SAT' })
    expect(readFixedPrice('bob')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem('lawallet-fixed-price:alice') ?? '{}')).toEqual({
      amount: '2500',
      currency: 'SAT',
    })
  })

  it('clears a local price reference', () => {
    saveFixedPrice('alice', { amount: '10.50', currency: 'USD' })
    saveFixedPrice('alice', null)

    expect(readFixedPrice('alice')).toBeNull()
    expect(window.localStorage.getItem('lawallet-fixed-price:alice')).toBeNull()
  })

  it('accepts positive whole sats and positive fiat decimals', () => {
    expect(isValidFixedPriceAmount('2500', 'SAT')).toBe(true)
    expect(isValidFixedPriceAmount('10.50', 'USD')).toBe(true)
    expect(isValidFixedPriceAmount('1.5', 'SAT')).toBe(false)
    expect(isValidFixedPriceAmount('0', 'SAT')).toBe(false)
    expect(isValidFixedPriceAmount('-1', 'USD')).toBe(false)
  })

  it('converts a fiat amount to sats using the Yadio BTC rate', () => {
    expect(estimateFixedPriceSats('10', 'USD', { USD: 50_000 })).toBe(20_000)
  })
})
