import { describe, it, expect } from 'vitest'
import { redisKeys, hashRelay } from '../../src/redis/keys.js'

describe('redis/keys', () => {
  it('namespaces all keys under nt:', () => {
    expect(redisKeys.dedup('x')).toBe('nt:dedup:x')
    expect(redisKeys.cursor('nwc', 'wss://a')).toMatch(/^nt:cursor:nwc:[0-9a-f]{16}$/)
    expect(redisKeys.relayStatus('wss://a')).toMatch(/^nt:relay:[0-9a-f]{16}:status$/)
  })

  it('hashes relay URL to a stable 16-char hex', () => {
    const a = hashRelay('wss://relay.example.com')
    const b = hashRelay('wss://relay.example.com')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })

  it('produces different hashes for different URLs', () => {
    expect(hashRelay('wss://a')).not.toBe(hashRelay('wss://b'))
  })
})
