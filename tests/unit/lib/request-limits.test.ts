import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  checkRequestLimits,
  checkFileLimits,
  type RequestLimitOptions
} from '@/lib/middleware/request-limits'
import { PayloadTooLargeError } from '@/types/server/errors'

// Mock config module
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    requestLimits: {
      maxBodySize: 1048576, // 1MB
      maxJsonSize: 102400, // 100KB
      maxFileSize: 5242880, // 5MB
      maxFiles: 10
    }
  }))
}))

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

/**
 * Creates a Request with a controllable Content-Length header.
 *
 * The Fetch API treats Content-Length as a forbidden header, so we can't set
 * it via the Headers constructor. Instead we create the request normally and
 * override `headers.get` so our middleware sees the value we want.
 */
function createRequest(
  options: {
    method?: string
    body?: string | null
    contentLength?: number | null
    contentType?: string
  } = {}
): Request {
  const {
    method = 'POST',
    body = null,
    contentLength,
    contentType = 'application/json'
  } = options

  const headers: Record<string, string> = {}
  if (contentType) headers['content-type'] = contentType

  const request = new Request('http://localhost:3000/api/test', {
    method,
    headers,
    body
  })

  // Patch headers.get so Content-Length is visible to the middleware
  if (contentLength !== undefined) {
    const originalGet = request.headers.get.bind(request.headers)
    request.headers.get = (name: string) => {
      if (name.toLowerCase() === 'content-length') {
        return contentLength === null ? null : String(contentLength)
      }
      return originalGet(name)
    }
  }

  return request
}

describe('checkRequestLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Skip Methods ────────────────────────────────────────────────────────

  describe('skip methods without body', () => {
    it.each(['GET', 'HEAD', 'OPTIONS'])('skips %s requests', async (method) => {
      const request = createRequest({ method })
      await expect(checkRequestLimits(request, 'json')).resolves.toBeUndefined()
    })
  })

  // ── Content-Length Fast Path ─────────────────────────────────────────────

  describe('Content-Length header check', () => {
    it('allows request within json preset limit', async () => {
      const request = createRequest({ contentLength: 50000 }) // 50KB < 100KB
      await expect(checkRequestLimits(request, 'json')).resolves.toBeUndefined()
    })

    it('allows request exactly at limit', async () => {
      const request = createRequest({ contentLength: 102400 }) // exactly 100KB
      await expect(checkRequestLimits(request, 'json')).resolves.toBeUndefined()
    })

    it('rejects request exceeding json preset limit', async () => {
      const request = createRequest({ contentLength: 200000 }) // 200KB > 100KB
      await expect(checkRequestLimits(request, 'json')).rejects.toThrow(
        PayloadTooLargeError
      )
    })

    it('allows request within large preset limit', async () => {
      const request = createRequest({ contentLength: 500000 }) // 500KB < 1MB
      await expect(checkRequestLimits(request, 'large')).resolves.toBeUndefined()
    })

    it('rejects request exceeding large preset limit', async () => {
      const request = createRequest({ contentLength: 2000000 }) // ~2MB > 1MB
      await expect(checkRequestLimits(request, 'large')).rejects.toThrow(
        PayloadTooLargeError
      )
    })

    it('includes details in error', async () => {
      const request = createRequest({ contentLength: 200000 })
      try {
        await checkRequestLimits(request, 'json')
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(PayloadTooLargeError)
        const err = error as PayloadTooLargeError
        expect(err.statusCode).toBe(413)
        expect(err.code).toBe('PAYLOAD_TOO_LARGE')
        expect(err.details).toEqual(
          expect.objectContaining({
            maxBodySize: 102400,
            contentLength: 200000,
            maxBodySizeHuman: '100.0 KB'
          })
        )
      }
    })

    it('provides human-readable error message', async () => {
      const request = createRequest({ contentLength: 200000 })
      try {
        await checkRequestLimits(request, 'json')
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect((error as PayloadTooLargeError).message).toContain('100.0 KB')
      }
    })
  })

  // ── Body Read Fallback ──────────────────────────────────────────────────

  describe('body read fallback (no Content-Length)', () => {
    it('allows body within limit', async () => {
      const body = 'x'.repeat(1000) // 1KB
      const request = createRequest({ body, contentLength: null })
      await expect(checkRequestLimits(request, 'json')).resolves.toBeUndefined()
    })

    it('rejects body exceeding limit', async () => {
      const body = 'x'.repeat(200000) // ~200KB > 100KB
      const request = createRequest({ body, contentLength: null })
      await expect(checkRequestLimits(request, 'json')).rejects.toThrow(
        PayloadTooLargeError
      )
    })

    it('allows POST with no body and no content-length', async () => {
      const request = new Request('http://localhost:3000/api/test', {
        method: 'POST',
        headers: {}
      })
      await expect(checkRequestLimits(request, 'json')).resolves.toBeUndefined()
    })
  })

  // ── Custom Options ──────────────────────────────────────────────────────

  describe('custom options', () => {
    it('accepts custom limit options', async () => {
      const customOptions: RequestLimitOptions = { maxBodySize: 500 }
      const request = createRequest({ contentLength: 300 })
      await expect(
        checkRequestLimits(request, customOptions)
      ).resolves.toBeUndefined()
    })

    it('rejects when exceeding custom limit', async () => {
      const customOptions: RequestLimitOptions = { maxBodySize: 500 }
      const request = createRequest({ contentLength: 600 })
      await expect(checkRequestLimits(request, customOptions)).rejects.toThrow(
        PayloadTooLargeError
      )
    })
  })

  // ── DELETE Method ───────────────────────────────────────────────────────

  describe('DELETE method', () => {
    it('checks body for DELETE requests with content', async () => {
      const request = createRequest({ method: 'DELETE', contentLength: 200000 })
      await expect(checkRequestLimits(request, 'json')).rejects.toThrow(
        PayloadTooLargeError
      )
    })
  })

  // ── PUT/PATCH Methods ───────────────────────────────────────────────────

  describe('PUT and PATCH methods', () => {
    it('checks PUT requests', async () => {
      const request = createRequest({ method: 'PUT', contentLength: 200000 })
      await expect(checkRequestLimits(request, 'json')).rejects.toThrow(
        PayloadTooLargeError
      )
    })

    it('checks PATCH requests', async () => {
      const request = createRequest({ method: 'PATCH', contentLength: 200000 })
      await expect(checkRequestLimits(request, 'json')).rejects.toThrow(
        PayloadTooLargeError
      )
    })
  })
})

describe('checkFileLimits', () => {
  function createFormDataWithFiles(
    files: Array<{ name: string; size: number }>
  ): FormData {
    const formData = new FormData()
    for (const { name, size } of files) {
      const content = new Uint8Array(size)
      const file = new File([content], name, { type: 'application/octet-stream' })
      formData.append('file', file)
    }
    return formData
  }

  // ── File Count ──────────────────────────────────────────────────────────

  describe('file count limits', () => {
    it('allows files within count limit', () => {
      const formData = createFormDataWithFiles([
        { name: 'a.txt', size: 100 },
        { name: 'b.txt', size: 100 }
      ])
      expect(() => checkFileLimits(formData, 'upload')).not.toThrow()
    })

    it('rejects too many files', () => {
      const files = Array.from({ length: 11 }, (_, i) => ({
        name: `file${i}.txt`,
        size: 100
      }))
      const formData = createFormDataWithFiles(files)
      expect(() => checkFileLimits(formData, 'upload')).toThrow(
        PayloadTooLargeError
      )
    })

    it('includes file count in error details', () => {
      const files = Array.from({ length: 15 }, (_, i) => ({
        name: `file${i}.txt`,
        size: 100
      }))
      const formData = createFormDataWithFiles(files)
      try {
        checkFileLimits(formData, 'upload')
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect((error as PayloadTooLargeError).details).toEqual(
          expect.objectContaining({
            maxFiles: 10,
            fileCount: 15
          })
        )
      }
    })
  })

  // ── Individual File Size ────────────────────────────────────────────────

  describe('individual file size limits', () => {
    it('allows files within size limit', () => {
      const formData = createFormDataWithFiles([
        { name: 'small.txt', size: 1000 }
      ])
      expect(() => checkFileLimits(formData, 'upload')).not.toThrow()
    })

    it('rejects file exceeding size limit', () => {
      const formData = createFormDataWithFiles([
        { name: 'huge.bin', size: 6000000 } // 6MB > 5MB
      ])
      expect(() => checkFileLimits(formData, 'upload')).toThrow(
        PayloadTooLargeError
      )
    })

    it('includes file name in error', () => {
      const formData = createFormDataWithFiles([
        { name: 'toolarge.bin', size: 6000000 }
      ])
      try {
        checkFileLimits(formData, 'upload')
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect((error as PayloadTooLargeError).message).toContain('toolarge.bin')
        expect((error as PayloadTooLargeError).details).toEqual(
          expect.objectContaining({
            fileName: 'toolarge.bin',
            maxFileSize: 5242880
          })
        )
      }
    })
  })

  // ── Custom Options ──────────────────────────────────────────────────────

  describe('custom file options', () => {
    it('accepts custom file limits', () => {
      const formData = createFormDataWithFiles([
        { name: 'a.txt', size: 100 }
      ])
      const options: RequestLimitOptions = {
        maxBodySize: 1000,
        maxFileSize: 200,
        maxFiles: 5
      }
      expect(() => checkFileLimits(formData, options)).not.toThrow()
    })

    it('rejects with custom max files', () => {
      const formData = createFormDataWithFiles([
        { name: 'a.txt', size: 100 },
        { name: 'b.txt', size: 100 },
        { name: 'c.txt', size: 100 }
      ])
      const options: RequestLimitOptions = {
        maxBodySize: 1000,
        maxFiles: 2
      }
      expect(() => checkFileLimits(formData, options)).toThrow(
        PayloadTooLargeError
      )
    })
  })

  // ── No File Constraints ─────────────────────────────────────────────────

  describe('no file constraints', () => {
    it('skips file checks when no file limits set', () => {
      const formData = createFormDataWithFiles([
        { name: 'any.bin', size: 99999999 }
      ])
      const options: RequestLimitOptions = { maxBodySize: 1000 }
      expect(() => checkFileLimits(formData, options)).not.toThrow()
    })
  })

  // ── Non-File FormData ───────────────────────────────────────────────────

  describe('non-file form data', () => {
    it('ignores non-file fields', () => {
      const formData = new FormData()
      formData.append('name', 'test')
      formData.append('email', 'test@example.com')
      expect(() => checkFileLimits(formData, 'upload')).not.toThrow()
    })
  })
})
