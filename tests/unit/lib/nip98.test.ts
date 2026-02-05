import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateAbsoluteUrl, bodyToPayload, validateNip98 } from '@/lib/nip98'

// Mock nostr-tools nip98
vi.mock('nostr-tools', async (importOriginal) => {
  const original = await importOriginal<typeof import('nostr-tools')>()
  return {
    ...original,
    nip98: {
      validateEvent: vi.fn().mockResolvedValue(true),
    },
  }
})

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('generateAbsoluteUrl', () => {
  it('returns absolute URL as-is', () => {
    expect(generateAbsoluteUrl('https://example.com/api')).toBe('https://example.com/api')
  })

  it('returns http URL as-is', () => {
    expect(generateAbsoluteUrl('http://localhost:3000/api')).toBe('http://localhost:3000/api')
  })

  it('prepends baseUrl to relative path starting with /', () => {
    expect(generateAbsoluteUrl('/api/test', 'https://example.com')).toBe(
      'https://example.com/api/test'
    )
  })

  it('prepends baseUrl to relative path without /', () => {
    expect(generateAbsoluteUrl('api/test', 'https://example.com')).toBe(
      'https://example.com/api/test'
    )
  })

  it('handles baseUrl with trailing slash', () => {
    expect(generateAbsoluteUrl('/path', 'https://example.com/')).toBe(
      'https://example.com/path'
    )
  })

  it('throws in server environment with no baseUrl', () => {
    // In test environment (node), window is undefined normally, but happy-dom may define it.
    // We test the branch by ensuring no window.location.origin is available.
    const originalWindow = globalThis.window
    // @ts-ignore
    delete globalThis.window
    try {
      expect(() => generateAbsoluteUrl('/path')).toThrow(
        'baseUrl is required in server environment'
      )
    } finally {
      globalThis.window = originalWindow
    }
  })
})

describe('bodyToPayload', () => {
  it('returns undefined for falsy body', () => {
    expect(bodyToPayload(null)).toBeUndefined()
    expect(bodyToPayload(undefined)).toBeUndefined()
    expect(bodyToPayload('')).toBeUndefined()
    expect(bodyToPayload(0)).toBeUndefined()
  })

  it('parses JSON string', () => {
    expect(bodyToPayload('{"key":"value"}')).toEqual({ key: 'value' })
  })

  it('wraps non-JSON string', () => {
    expect(bodyToPayload('hello')).toEqual({ body: 'hello' })
  })

  it('converts FormData to object', () => {
    const fd = new FormData()
    fd.append('name', 'Alice')
    fd.append('age', '30')
    expect(bodyToPayload(fd)).toEqual({ name: 'Alice', age: '30' })
  })

  it('converts URLSearchParams to object', () => {
    const params = new URLSearchParams({ foo: 'bar', baz: '1' })
    expect(bodyToPayload(params)).toEqual({ foo: 'bar', baz: '1' })
  })

  it('returns object body as-is', () => {
    const obj = { a: 1, b: 2 }
    expect(bodyToPayload(obj)).toBe(obj)
  })
})

describe('validateNip98', () => {
  function createNip98Event(overrides: Record<string, any> = {}) {
    return {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: 'a'.repeat(64),
      tags: [
        ['u', 'http://localhost:3000/api/test'],
        ['method', 'GET'],
      ],
      content: '',
      id: 'event_id',
      sig: 'event_sig',
      ...overrides,
    }
  }

  function createNip98Request(event: any, url = 'http://localhost:3000/api/test') {
    const base64 = btoa(JSON.stringify(event))
    return new Request(url, {
      method: 'GET',
      headers: { Authorization: `Nostr ${base64}` },
    })
  }

  it('throws when Authorization header is missing', async () => {
    const request = new Request('http://localhost/api/test')
    await expect(validateNip98(request)).rejects.toThrow('Authorization header is required')
  })

  it('throws when header does not start with Nostr', async () => {
    const request = new Request('http://localhost/api/test', {
      headers: { Authorization: 'Bearer abc' },
    })
    await expect(validateNip98(request)).rejects.toThrow(
      'Authorization header must start with "Nostr "'
    )
  })

  it('throws when event data is empty', async () => {
    const request = new Request('http://localhost/api/test', {
      headers: { Authorization: 'Nostr ' },
    })
    await expect(validateNip98(request)).rejects.toThrow('Event data is required')
  })

  it('throws for invalid base64/JSON', async () => {
    const request = new Request('http://localhost/api/test', {
      headers: { Authorization: 'Nostr !!!invalid-base64!!!' },
    })
    await expect(validateNip98(request)).rejects.toThrow('Invalid event format')
  })

  it('validates a correct NIP-98 event', async () => {
    const event = createNip98Event()
    const request = createNip98Request(event)
    const result = await validateNip98(request)
    expect(result.pubkey).toBe('a'.repeat(64))
    expect(result.event).toEqual(event)
  })

  it('throws when event timestamp is too old', async () => {
    const event = createNip98Event({
      created_at: Math.floor(Date.now() / 1000) - 120,
    })
    const request = createNip98Request(event)
    await expect(validateNip98(request, 60)).rejects.toThrow(
      'Event timestamp is too old or too new'
    )
  })

  it('throws when nip98.validateEvent returns false', async () => {
    const { nip98 } = await import('nostr-tools')
    vi.mocked(nip98.validateEvent).mockResolvedValueOnce(false)

    const event = createNip98Event()
    const request = createNip98Request(event)
    await expect(validateNip98(request)).rejects.toThrow('Event validation failed')
  })

  it('uses x-forwarded-host and x-forwarded-proto headers for URL reconstruction', async () => {
    const { nip98 } = await import('nostr-tools')
    vi.mocked(nip98.validateEvent).mockResolvedValue(true)

    const event = createNip98Event()
    const request = new Request('http://internal:3000/api/test', {
      method: 'GET',
      headers: {
        Authorization: `Nostr ${btoa(JSON.stringify(event))}`,
        'x-forwarded-host': 'public.example.com',
        'x-forwarded-proto': 'https',
      },
    })

    await validateNip98(request)

    expect(nip98.validateEvent).toHaveBeenCalledWith(
      event,
      'https://public.example.com/api/test',
      'GET',
      expect.any(String)
    )
  })
})
