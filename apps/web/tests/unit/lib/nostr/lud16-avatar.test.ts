import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/nostr/profile-cache', () => ({
  resolveProfiles: vi.fn().mockResolvedValue([]),
}))

import { promises as fsPromises } from 'node:fs'
import {
  getLud16AvatarMetadataEntry,
  warmNostrProfileForLud16,
} from '@/lib/nostr/lud16-avatar'
import { resolveProfiles } from '@/lib/nostr/profile-cache'

// The helper imports the same `node:fs` `promises` singleton, so spying on this
// object's `readFile` intercepts its reads without touching the real disk.
const readFileMock = vi.spyOn(fsPromises, 'readFile')

// A valid 64-char hex pubkey so normalizeNostrPubkey resolves an npub.
const PUBKEY = 'a'.repeat(64)

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  resetPrismaMock()
  readFileMock.mockReset()
  vi.mocked(resolveProfiles).mockClear()
})

describe('getLud16AvatarMetadataEntry', () => {
  it('returns a base64 image metadata entry from the cache', async () => {
    vi.mocked(prismaMock.nostrProfileImageCache.findUnique).mockResolvedValue({
      cachePath: '/cache/avatar.png',
      contentType: 'image/png',
      byteSize: 3,
    } as any)
    readFileMock.mockResolvedValue(Buffer.from([1, 2, 3]))

    const entry = await getLud16AvatarMetadataEntry(PUBKEY)

    expect(entry).toEqual(['image/png;base64', Buffer.from([1, 2, 3]).toString('base64')])
  })

  it('returns null when the user has no cached avatar', async () => {
    vi.mocked(prismaMock.nostrProfileImageCache.findUnique).mockResolvedValue(null as any)
    expect(await getLud16AvatarMetadataEntry(PUBKEY)).toBeNull()
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('returns null for a non-embeddable mime type (e.g. gif)', async () => {
    vi.mocked(prismaMock.nostrProfileImageCache.findUnique).mockResolvedValue({
      cachePath: '/cache/avatar.gif',
      contentType: 'image/gif',
      byteSize: 3,
    } as any)
    expect(await getLud16AvatarMetadataEntry(PUBKEY)).toBeNull()
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('returns null when the cached image exceeds the embed size cap', async () => {
    vi.mocked(prismaMock.nostrProfileImageCache.findUnique).mockResolvedValue({
      cachePath: '/cache/avatar.png',
      contentType: 'image/png',
      byteSize: 5 * 1024 * 1024,
    } as any)
    expect(await getLud16AvatarMetadataEntry(PUBKEY)).toBeNull()
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('returns null when the cache file cannot be read', async () => {
    vi.mocked(prismaMock.nostrProfileImageCache.findUnique).mockResolvedValue({
      cachePath: '/cache/missing.png',
      contentType: 'image/png',
      byteSize: 3,
    } as any)
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    expect(await getLud16AvatarMetadataEntry(PUBKEY)).toBeNull()
  })

  it('returns null for an invalid pubkey without touching the DB', async () => {
    expect(await getLud16AvatarMetadataEntry('not-a-pubkey')).toBeNull()
    expect(prismaMock.nostrProfileImageCache.findUnique).not.toHaveBeenCalled()
  })
})

describe('warmNostrProfileForLud16', () => {
  it('fetches the profile the first time a pubkey is seen', async () => {
    vi.mocked(prismaMock.nostrProfileCache.findUnique).mockResolvedValue(null as any)

    warmNostrProfileForLud16(PUBKEY)
    await flush()

    expect(resolveProfiles).toHaveBeenCalledWith([PUBKEY], expect.anything())
  })

  it('does not re-fetch once a profile row exists', async () => {
    vi.mocked(prismaMock.nostrProfileCache.findUnique).mockResolvedValue({
      pubkey: PUBKEY,
    } as any)

    warmNostrProfileForLud16(PUBKEY)
    await flush()

    expect(resolveProfiles).not.toHaveBeenCalled()
  })

  it('is a no-op for an invalid pubkey', async () => {
    warmNostrProfileForLud16('not-a-pubkey')
    await flush()
    expect(resolveProfiles).not.toHaveBeenCalled()
  })
})
