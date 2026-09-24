import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  getPaymentSound,
  playPaymentCueSound,
  playPaymentSuccessSound,
  setPaymentSound,
  usePaymentSound
} from '@/lib/client/payment-sound'

describe('payment-sound', () => {
  const play = vi.fn(() => Promise.resolve())
  const AudioMock = vi.fn(function AudioMock(this: {
    src: string
    play: typeof play
  }) {
    this.src = ''
    this.play = play
  })

  beforeEach(() => {
    window.localStorage.clear()
    play.mockClear()
    AudioMock.mockClear()
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal('AudioContext', undefined)
  })

  it('defaults to silent', () => {
    expect(getPaymentSound()).toBe('off')
    const { result } = renderHook(() => usePaymentSound())
    expect(result.current).toBe('off')
  })

  it('persists a chosen option', () => {
    act(() => setPaymentSound('bananero'))
    expect(window.localStorage.getItem('lawallet-payment-sound:v1')).toBe(
      'bananero'
    )
    const { result } = renderHook(() => usePaymentSound())
    expect(result.current).toBe('bananero')
  })

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem('lawallet-payment-sound:v1', 'nope')
    expect(getPaymentSound()).toBe('off')
  })

  it('plays the bananero file and stays silent when off', () => {
    playPaymentSuccessSound('bananero')
    expect(AudioMock).toHaveBeenCalledWith('/sounds/sapeee-el-bananero.mp3')
    expect(play).toHaveBeenCalledOnce()

    AudioMock.mockClear()
    playPaymentSuccessSound('off')
    expect(AudioMock).not.toHaveBeenCalled()
  })

  it('plays a cue once', () => {
    setPaymentSound('bananero')
    playPaymentCueSound('incoming:once')
    playPaymentCueSound('incoming:once')
    expect(AudioMock).toHaveBeenCalledOnce()
  })
})
