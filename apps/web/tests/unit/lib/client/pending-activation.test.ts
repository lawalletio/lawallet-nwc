import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  clearPendingActivation,
  postAuthPath,
  rememberPendingActivation
} from '@/lib/client/pending-activation'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('pending activation', () => {
  it('falls back when no card is pending', () => {
    expect(postAuthPath('/wallet')).toBe('/wallet')
  })

  it('returns to the remembered card after login', () => {
    rememberPendingActivation('tok-123')
    expect(postAuthPath('/wallet/welcome')).toBe('/wallet/activate/tok-123')
  })

  it('forgets the card once cleared', () => {
    rememberPendingActivation('tok-123')
    clearPendingActivation()
    expect(postAuthPath('/wallet')).toBe('/wallet')
  })

  it('ignores an abandoned card after the TTL', () => {
    vi.useFakeTimers()
    rememberPendingActivation('tok-123')
    vi.advanceTimersByTime(61 * 60 * 1000)
    expect(postAuthPath('/wallet')).toBe('/wallet')
  })

  it('ignores malformed storage', () => {
    localStorage.setItem('lawallet:pending-activation', '{not json')
    expect(postAuthPath('/wallet')).toBe('/wallet')
  })
})
