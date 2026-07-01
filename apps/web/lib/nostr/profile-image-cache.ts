import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { promises as fs } from 'node:fs'
import { isIP } from 'node:net'
import path from 'node:path'

import { prisma } from '@/lib/prisma'
import { getConfig } from '@/lib/config'
import type { NostrProfile } from '@/lib/nostr/profile'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_TIMEOUT_MS = 10_000
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

export type ProfileImageKind = 'AVATAR' | 'COVER'

interface PrecacheImageInput {
  npub: string
  kind: ProfileImageKind
  remoteUrl: string
}

interface PrecacheOptions {
  fetchImpl?: typeof fetch
  cacheDir?: string
  db?: typeof prisma
}

export async function precacheProfileImages(
  profile: Pick<NostrProfile, 'npub' | 'picture' | 'banner'>,
  options: PrecacheOptions = {},
) {
  const tasks: Promise<void>[] = []
  if (profile.picture) {
    tasks.push(
      precacheProfileImage({
        npub: profile.npub,
        kind: 'AVATAR',
        remoteUrl: profile.picture,
      }, options),
    )
  }
  if (profile.banner) {
    tasks.push(
      precacheProfileImage({
        npub: profile.npub,
        kind: 'COVER',
        remoteUrl: profile.banner,
      }, options),
    )
  }

  await Promise.allSettled(tasks)
}

export async function precacheProfileImage(
  input: PrecacheImageInput,
  options: PrecacheOptions = {},
) {
  const db = options.db ?? prisma
  const now = new Date()

  try {
    await assertSafeImageUrl(input.remoteUrl)

    const fetchImpl = options.fetchImpl ?? fetch
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetchImpl(input.remoteUrl, {
        signal: controller.signal,
        redirect: 'follow',
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      throw new Error(`Image fetch failed with ${response.status}`)
    }

    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new Error(`Unsupported image content type: ${contentType || 'unknown'}`)
    }

    const contentLength = Number(response.headers.get('content-length') ?? '0')
    if (contentLength > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds 5MB limit')
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds 5MB limit')
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const ext = EXT_BY_TYPE[contentType] ?? 'img'
    const cachePath = path.join(
      resolveProfileCacheDir(options.cacheDir),
      input.npub,
      `${input.kind.toLowerCase()}-${sha256}.${ext}`,
    )
    await fs.mkdir(path.dirname(cachePath), { recursive: true })
    await fs.writeFile(cachePath, bytes)

    await db.nostrProfileImageCache.upsert({
      where: { npub_kind: { npub: input.npub, kind: input.kind } },
      create: {
        npub: input.npub,
        kind: input.kind,
        remoteUrl: input.remoteUrl,
        cachePath,
        contentType,
        byteSize: bytes.byteLength,
        sha256,
        cachedAt: now,
        failedAt: null,
        lastError: null,
      },
      update: {
        remoteUrl: input.remoteUrl,
        cachePath,
        contentType,
        byteSize: bytes.byteLength,
        sha256,
        cachedAt: now,
        failedAt: null,
        lastError: null,
      },
    })
  } catch (err) {
    await db.nostrProfileImageCache.upsert({
      where: { npub_kind: { npub: input.npub, kind: input.kind } },
      create: {
        npub: input.npub,
        kind: input.kind,
        remoteUrl: input.remoteUrl,
        failedAt: now,
        lastError: errorMessage(err),
      },
      update: {
        remoteUrl: input.remoteUrl,
        cachePath: null,
        contentType: null,
        byteSize: null,
        sha256: null,
        cachedAt: null,
        failedAt: now,
        lastError: errorMessage(err),
      },
    })
  }
}

export function resolveProfileCacheDir(override?: string): string {
  if (override) return path.resolve(override)
  const configured = getConfig(false).nostrProfileCache?.dir
  if (configured) return path.resolve(configured)
  if (process.env.NODE_ENV === 'production') return '/app/data/nostr-profiles'
  return path.resolve(process.cwd(), '.cache/nostr-profiles')
}

async function assertSafeImageUrl(rawUrl: string) {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Invalid image URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) image URLs can be cached')
  }

  const hostname = parsed.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    throw new Error('Local image hostnames are not cacheable')
  }

  const literalIp = isIP(hostname)
  if (literalIp && isPrivateAddress(hostname)) {
    throw new Error('Private image hosts are not cacheable')
  }

  if (!literalIp) {
    const records = await dns.lookup(hostname, { all: true })
    if (records.some(record => isPrivateAddress(record.address))) {
      throw new Error('Private image hosts are not cacheable')
    }
  }
}

function isPrivateAddress(address: string): boolean {
  if (address.startsWith('::ffff:')) {
    return isPrivateAddress(address.slice(7))
  }

  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(part => Number(part))
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }

  const lower = address.toLowerCase()
  return (
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80:')
  )
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
