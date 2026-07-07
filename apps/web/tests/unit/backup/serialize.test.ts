import { describe, it, expect } from 'vitest'
import {
  sha256,
  toNdjson,
  fromNdjson,
  canonicalJson,
  rowsEqual,
  utf8Encode,
  utf8Decode,
  BACKUP_README,
} from '@/lib/backup/serialize'

describe('backup serialize', () => {
  describe('toNdjson / fromNdjson', () => {
    it('round-trips an array of objects', () => {
      const rows = [
        { id: 'a', n: 1, flag: true },
        { id: 'b', n: 2, flag: false },
        { id: 'c', nested: { x: [1, 2, 3] } },
      ]
      const text = toNdjson(rows)
      expect(text.split('\n')).toHaveLength(3)
      expect(fromNdjson(text)).toEqual(rows)
    })

    it('serializes an empty array to an empty string', () => {
      expect(toNdjson([])).toBe('')
      expect(fromNdjson('')).toEqual([])
    })

    it('skips blank lines when parsing', () => {
      expect(fromNdjson('\n\n{"id":"a"}\n\n')).toEqual([{ id: 'a' }])
    })
  })

  describe('canonicalJson', () => {
    it('is key-order-independent', () => {
      const a = { z: 1, a: 2, m: { q: 3, b: 4 } }
      const b = { a: 2, m: { b: 4, q: 3 }, z: 1 }
      expect(canonicalJson(a)).toBe(canonicalJson(b))
    })

    it('normalizes Date to its ISO string', () => {
      const iso = '2026-07-06T12:00:00.000Z'
      expect(canonicalJson(new Date(iso))).toBe(canonicalJson(iso))
    })

    it('normalizes undefined to null', () => {
      expect(canonicalJson(undefined)).toBe('null')
      expect(canonicalJson(null)).toBe('null')
    })
  })

  describe('rowsEqual', () => {
    it('is true for a Date vs its ISO string', () => {
      const iso = '2026-01-01T00:00:00.000Z'
      expect(rowsEqual({ createdAt: new Date(iso) }, { createdAt: iso })).toBe(true)
    })

    it('is true regardless of key order', () => {
      expect(rowsEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    })

    it('is false for differing values', () => {
      expect(rowsEqual({ a: 1 }, { a: 2 })).toBe(false)
      expect(rowsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    })
  })

  describe('sha256', () => {
    it('is deterministic and hex-encoded', () => {
      const bytes = utf8Encode('lawallet')
      const a = sha256(bytes)
      const b = sha256(utf8Encode('lawallet'))
      expect(a).toBe(b)
      expect(a).toMatch(/^[0-9a-f]{64}$/)
    })

    it('differs for different input', () => {
      expect(sha256(utf8Encode('a'))).not.toBe(sha256(utf8Encode('b')))
    })
  })

  describe('utf8 encode / decode', () => {
    it('round-trips unicode text', () => {
      const text = 'héllo ⚡ 世界'
      expect(utf8Decode(utf8Encode(text))).toBe(text)
    })
  })

  it('BACKUP_README warns about sensitive data', () => {
    expect(BACKUP_README).toContain('SENSITIVE DATA')
    expect(BACKUP_README).toContain('manifest.json')
  })
})
