import { describe, it, expect } from 'vitest'
import {
  MEDIA_URL_MAX_LENGTH,
  createCardDesignSchema,
  externalUrlSchema,
  imageUrlSchema,
  storedImageUrlSchema,
  updateCardDesignSchema
} from '@/lib/validation/schemas'
import { ROW_SCHEMAS } from '@/lib/backup/row-schemas'

/**
 * Zod 3's `.url()` is a bare `new URL()` check, so on its own it accepts every
 * scheme — `javascript:`, `data:`, `file:` included. These cover the scheme
 * allowlist that was added on top of it, for each place an image URL can
 * enter the system: the card-design create/update API, and backup restore.
 */

/** Schemes that must never be storable, whatever the entry point. */
const REJECTED_SCHEMES = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(document.domain)',
  '  javascript:alert(1)  ',
  'javascript:void(document.cookie)',
  'data:image/png;base64,iVBORw0KGgo=',
  'data:image/svg+xml,<svg onload="alert(1)"/>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'file:///etc/passwd',
  'vbscript:msgbox(1)',
  'blob:https://example.com/9f8e7d6c',
  'mailto:someone@example.com',
  'ftp://example.com/card.png',
  'ws://example.com/card.png'
]

describe('imageUrlSchema (API input)', () => {
  it.each([
    'https://blossom.example.com/abc123.png',
    'http://localhost:3000/card.png',
    'https://cdn.example.com/a/b/c.webp?v=2#frag'
  ])('accepts http(s) URL %s', url => {
    expect(imageUrlSchema.parse(url)).toBe(url)
  })

  it.each(REJECTED_SCHEMES)('rejects %s', url => {
    expect(imageUrlSchema.safeParse(url).success).toBe(false)
  })

  it('trims surrounding whitespace on accepted values', () => {
    expect(imageUrlSchema.parse('  https://example.com/a.png  ')).toBe(
      'https://example.com/a.png'
    )
  })

  it('rejects a relative path (never accepted by the previous .url() either)', () => {
    expect(imageUrlSchema.safeParse('/card-primal.png').success).toBe(false)
    expect(imageUrlSchema.safeParse('card.png').success).toBe(false)
  })

  it('rejects a protocol-relative URL', () => {
    expect(imageUrlSchema.safeParse('//evil.example.com/x.png').success).toBe(
      false
    )
  })

  it('rejects an http URL with no hostname', () => {
    expect(imageUrlSchema.safeParse('http://').success).toBe(false)
  })

  it(`rejects a URL longer than ${MEDIA_URL_MAX_LENGTH} characters`, () => {
    const long = `https://example.com/${'a'.repeat(MEDIA_URL_MAX_LENGTH)}.png`
    expect(imageUrlSchema.safeParse(long).success).toBe(false)
  })

  it('accepts a URL exactly at the length limit', () => {
    const prefix = 'https://example.com/'
    const url = prefix + 'a'.repeat(MEDIA_URL_MAX_LENGTH - prefix.length)
    expect(url).toHaveLength(MEDIA_URL_MAX_LENGTH)
    expect(imageUrlSchema.safeParse(url).success).toBe(true)
  })
})

describe('externalUrlSchema (rendered as a link href)', () => {
  it.each([
    'https://cafe.example.com/promos/spring',
    'http://localhost:3000/offer',
    'https://shop.example.com/a/b?utm=1#top'
  ])('accepts http(s) URL %s', url => {
    expect(externalUrlSchema.parse(url)).toBe(url)
  })

  // Sharper than the image case: `javascript:` is inert in an `<img src>` but
  // executes from an `<a href>` on click. Same fixture, so the two guards are
  // held to one standard.
  it.each(REJECTED_SCHEMES)('rejects %s', url => {
    expect(externalUrlSchema.safeParse(url).success).toBe(false)
  })

  it(`rejects a URL longer than ${MEDIA_URL_MAX_LENGTH} characters`, () => {
    const long = `https://example.com/${'a'.repeat(MEDIA_URL_MAX_LENGTH)}`
    expect(externalUrlSchema.safeParse(long).success).toBe(false)
  })
})

describe('createCardDesignSchema', () => {
  it('accepts an https image URL', () => {
    expect(
      createCardDesignSchema.parse({
        description: 'Blue card',
        imageUrl: 'https://blossom.example.com/abc.png'
      })
    ).toEqual({
      description: 'Blue card',
      imageUrl: 'https://blossom.example.com/abc.png'
    })
  })

  it.each(REJECTED_SCHEMES)('rejects imageUrl %s', url => {
    const res = createCardDesignSchema.safeParse({
      description: 'Blue card',
      imageUrl: url
    })
    expect(res.success).toBe(false)
  })
})

describe('updateCardDesignSchema', () => {
  it('accepts an https image URL', () => {
    expect(
      updateCardDesignSchema.parse({ imageUrl: 'https://example.com/a.png' })
    ).toEqual({ imageUrl: 'https://example.com/a.png' })
  })

  it.each(REJECTED_SCHEMES)('rejects imageUrl %s', url => {
    expect(updateCardDesignSchema.safeParse({ imageUrl: url }).success).toBe(
      false
    )
  })

  it('still rejects an empty payload', () => {
    expect(updateCardDesignSchema.safeParse({}).success).toBe(false)
  })
})

describe('storedImageUrlSchema (backup restore)', () => {
  it.each(REJECTED_SCHEMES)('rejects %s', url => {
    expect(storedImageUrlSchema.safeParse(url).success).toBe(false)
  })

  it.each([
    // prisma/seed.ts writes these directly through Prisma, so a backup taken
    // from a seeded instance legitimately contains them.
    '/card-primal.png',
    '/card-alby.png',
    '/images/designs/metal.webp'
  ])('accepts seeded root-relative path %s', url => {
    expect(storedImageUrlSchema.parse(url)).toBe(url)
  })

  it('accepts http(s) URLs', () => {
    expect(storedImageUrlSchema.parse('https://example.com/a.png')).toBe(
      'https://example.com/a.png'
    )
  })

  it('accepts an empty string (inert, renders as "No image")', () => {
    expect(storedImageUrlSchema.parse('')).toBe('')
  })

  it('rejects a protocol-relative path', () => {
    expect(
      storedImageUrlSchema.safeParse('//evil.example.com/x.png').success
    ).toBe(false)
  })

  it(`rejects a value longer than ${MEDIA_URL_MAX_LENGTH} characters`, () => {
    expect(
      storedImageUrlSchema.safeParse(`/${'a'.repeat(MEDIA_URL_MAX_LENGTH)}.png`)
        .success
    ).toBe(false)
  })
})

describe('backup cardDesigns row schema', () => {
  const row = {
    id: 'design-001',
    description: 'Primal card',
    createdAt: '2024-01-10T08:00:00.000Z',
    archivedAt: null,
    userId: null
  }

  it('accepts a seeded row with a root-relative imageUrl', () => {
    const res = ROW_SCHEMAS.cardDesigns.safeParse({
      ...row,
      imageUrl: '/card-primal.png'
    })
    expect(res.success).toBe(true)
  })

  it.each(REJECTED_SCHEMES)('rejects a row whose imageUrl is %s', url => {
    const res = ROW_SCHEMAS.cardDesigns.safeParse({ ...row, imageUrl: url })
    expect(res.success).toBe(false)
  })
})
