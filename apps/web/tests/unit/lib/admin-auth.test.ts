import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { Role, Permission } from '@/lib/auth/permissions'
import { AuthenticationError, AuthorizationError } from '@/types/server/errors'

// Mock dependencies
vi.mock('@/lib/nip98', () => ({
  validateNip98: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

import {
  validateNip98Auth,
  validateRoleAuth,
  validatePermissionAuth,
  validateAdminAuth,
  withAdminAuth,
  withRoleAuth,
  withPermissionAuth,
} from '@/lib/admin-auth'
import { validateNip98 } from '@/lib/nip98'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'

const PUBKEY = 'a'.repeat(64)

beforeEach(() => {
  vi.clearAllMocks()
})

function mockRequest(url = 'http://localhost:3000/api/admin/test') {
  return new Request(url, {
    method: 'GET',
    headers: { Authorization: 'Nostr dGVzdA==' },
  })
}

describe('validateNip98Auth', () => {
  it('returns pubkey on success', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    const result = await validateNip98Auth(mockRequest())
    expect(result).toBe(PUBKEY)
  })

  it('throws AuthenticationError on nip98 failure', async () => {
    vi.mocked(validateNip98).mockRejectedValue(new Error('bad event'))
    await expect(validateNip98Auth(mockRequest())).rejects.toThrow(AuthenticationError)
  })
})

describe('validateRoleAuth', () => {
  beforeEach(() => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
  })

  it('passes when user has sufficient role from DB', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: 'ADMIN',
    } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const result = await validateRoleAuth(mockRequest(), Role.ADMIN)
    expect(result).toBe(PUBKEY)
  })

  it('throws AuthorizationError when user role is insufficient', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: 'USER',
    } as any)
    vi.mocked(getSettings).mockResolvedValue({ root: 'different_pubkey' })

    await expect(
      validateRoleAuth(mockRequest(), Role.ADMIN)
    ).rejects.toThrow(AuthorizationError)
  })

  it('falls back to Settings root for ADMIN role', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: 'USER',
    } as any)
    vi.mocked(getSettings).mockResolvedValue({ root: PUBKEY })

    const result = await validateRoleAuth(mockRequest(), Role.ADMIN)
    expect(result).toBe(PUBKEY)
  })

  it('handles user not found in DB (fallback to settings)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(getSettings).mockResolvedValue({ root: PUBKEY })

    const result = await validateRoleAuth(mockRequest(), Role.ADMIN)
    expect(result).toBe(PUBKEY)
  })

  it('returns USER role when not in DB and not root', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(getSettings).mockResolvedValue({ root: 'different' })

    await expect(
      validateRoleAuth(mockRequest(), Role.VIEWER)
    ).rejects.toThrow(AuthorizationError)
  })
})

describe('validatePermissionAuth', () => {
  beforeEach(() => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
  })

  it('passes when user role has the permission', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'ADMIN' } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const result = await validatePermissionAuth(mockRequest(), Permission.SETTINGS_WRITE)
    expect(result).toBe(PUBKEY)
  })

  it('throws AuthorizationError when permission is missing', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'USER' } as any)
    vi.mocked(getSettings).mockResolvedValue({ root: 'different' })

    await expect(
      validatePermissionAuth(mockRequest(), Permission.SETTINGS_WRITE)
    ).rejects.toThrow(AuthorizationError)
  })
})

describe('validateAdminAuth', () => {
  it('delegates to validateRoleAuth with ADMIN', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'ADMIN' } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const result = await validateAdminAuth(mockRequest())
    expect(result).toBe(PUBKEY)
  })
})

describe('withAdminAuth', () => {
  it('calls handler after successful admin auth', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'ADMIN' } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const wrapped = withAdminAuth(handler)
    const response = await wrapped(mockRequest())
    expect(handler).toHaveBeenCalled()
    expect(response.status).toBe(200)
  })

  it('throws and does not call handler on auth failure', async () => {
    vi.mocked(validateNip98).mockRejectedValue(new Error('bad'))
    const handler = vi.fn()
    const wrapped = withAdminAuth(handler)
    await expect(wrapped(mockRequest())).rejects.toThrow(AuthenticationError)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('withRoleAuth', () => {
  it('calls handler when role is sufficient', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'OPERATOR' } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const wrapped = withRoleAuth(handler, Role.VIEWER)
    await wrapped(mockRequest())
    expect(handler).toHaveBeenCalled()
  })
})

describe('withPermissionAuth', () => {
  it('calls handler when permission is granted', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'ADMIN' } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const wrapped = withPermissionAuth(handler, Permission.CARDS_READ)
    await wrapped(mockRequest())
    expect(handler).toHaveBeenCalled()
  })

  it('throws when permission is denied', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'USER' } as any)
    vi.mocked(getSettings).mockResolvedValue({ root: 'different' })

    const handler = vi.fn()
    const wrapped = withPermissionAuth(handler, Permission.CARDS_WRITE)
    await expect(wrapped(mockRequest())).rejects.toThrow(AuthorizationError)
    expect(handler).not.toHaveBeenCalled()
  })
})
