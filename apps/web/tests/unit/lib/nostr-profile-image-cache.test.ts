import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { precacheProfileImage } from '@/lib/nostr/profile-image-cache'

const NPUB = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdl7y9r'
const PUBLIC_IMAGE_URL = 'https://93.184.216.34/avatar.png'

let tempDir: string

function mockFetch(response: Response): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch
}

beforeEach(async () => {
  resetPrismaMock()
  vi.clearAllMocks()
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lawallet-nostr-cache-'))
  vi.mocked(prismaMock.nostrProfileImageCache.upsert).mockResolvedValue({} as any)
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('precacheProfileImage', () => {
  it('writes valid image bytes and stores cache metadata', async () => {
    const fetchImpl = mockFetch(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/png' },
      }),
    )

    await precacheProfileImage(
      { npub: NPUB, kind: 'AVATAR', remoteUrl: PUBLIC_IMAGE_URL },
      { fetchImpl, cacheDir: tempDir },
    )

    const call = vi.mocked(prismaMock.nostrProfileImageCache.upsert).mock.calls[0]?.[0] as any
    expect(call.update).toMatchObject({
      remoteUrl: PUBLIC_IMAGE_URL,
      contentType: 'image/png',
      byteSize: 3,
      failedAt: null,
      lastError: null,
    })
    expect(call.update.cachePath).toContain(tempDir)
    await expect(fs.stat(call.update.cachePath)).resolves.toMatchObject({
      size: 3,
    })
  })

  it('rejects private image URLs without throwing to the caller', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch

    await expect(
      precacheProfileImage(
        { npub: NPUB, kind: 'AVATAR', remoteUrl: 'http://127.0.0.1/a.png' },
        { fetchImpl, cacheDir: tempDir },
      ),
    ).resolves.toBeUndefined()

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(prismaMock.nostrProfileImageCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          failedAt: expect.any(Date),
          lastError: expect.stringContaining('Private image hosts'),
        }),
      }),
    )
  })

  it('records unsupported content types as cache failures', async () => {
    const fetchImpl = mockFetch(
      new Response('not image', {
        headers: { 'content-type': 'text/html' },
      }),
    )

    await precacheProfileImage(
      { npub: NPUB, kind: 'COVER', remoteUrl: PUBLIC_IMAGE_URL },
      { fetchImpl, cacheDir: tempDir },
    )

    expect(prismaMock.nostrProfileImageCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          cachePath: null,
          lastError: expect.stringContaining('Unsupported image content type'),
        }),
      }),
    )
  })

  it('records images over 5MB as cache failures', async () => {
    const fetchImpl = mockFetch(
      new Response(new Uint8Array([1]), {
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(5 * 1024 * 1024 + 1),
        },
      }),
    )

    await precacheProfileImage(
      { npub: NPUB, kind: 'AVATAR', remoteUrl: PUBLIC_IMAGE_URL },
      { fetchImpl, cacheDir: tempDir },
    )

    expect(prismaMock.nostrProfileImageCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          lastError: 'Image exceeds 5MB limit',
        }),
      }),
    )
  })
})
