import { describe, it, expect } from 'vitest'
import { splitBtcForEmphasis } from '@/components/wallet/home-screen'

describe('splitBtcForEmphasis', () => {
  it('treats values >= 1 BTC as fully significant', () => {
    expect(splitBtcForEmphasis('1.23456789')).toEqual({
      gray: '',
      white: '1.23456789',
    })
    expect(splitBtcForEmphasis('21000000.00000000')).toEqual({
      gray: '',
      white: '21000000.00000000',
    })
  })

  it('mutes leading zeros for sub-BTC values', () => {
    expect(splitBtcForEmphasis('0.00001000')).toEqual({
      gray: '0.0000',
      white: '1000',
    })
    expect(splitBtcForEmphasis('0.00000001')).toEqual({
      gray: '0.0000000',
      white: '1',
    })
    expect(splitBtcForEmphasis('0.10000000')).toEqual({
      gray: '0.',
      white: '10000000',
    })
  })

  it('greys out the entire string for a zero balance', () => {
    expect(splitBtcForEmphasis('0.00000000')).toEqual({
      gray: '0.00000000',
      white: '',
    })
  })

  it('handles strings with no decimal point', () => {
    expect(splitBtcForEmphasis('0')).toEqual({ gray: '', white: '0' })
  })
})
