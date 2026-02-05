import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceUnavailableError } from '@/types/server/errors'
import { Role } from '@/lib/auth/permissions'

// Mock dependencies
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}))

vi.mock('@/lib/admin-auth', () => ({
  validateNip98Auth: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}))

import { checkMaintenance } from '@/lib/middleware/maintenance'
import { getConfig } from '@/lib/config'
import { validateNip98Auth } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'

function mockRequest(url = 'http://localhost:3000/api/test') {
  return new Request(url)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkMaintenance', () => {
  it('passes through when maintenance is disabled', async () => {
    vi.mocked(getConfig).mockReturnValue({
      maintenance: { enabled: false },
    } as any)

    await expect(checkMaintenance(mockRequest())).resolves.toBeUndefined()
    expect(validateNip98Auth).not.toHaveBeenCalled()
  })

  it('throws ServiceUnavailableError when maintenance is enabled and no auth', async () => {
    vi.mocked(getConfig).mockReturnValue({
      maintenance: { enabled: true },
    } as any)
    vi.mocked(validateNip98Auth).mockRejectedValue(new Error('no auth'))

    await expect(checkMaintenance(mockRequest())).rejects.toThrow(ServiceUnavailableError)
    await expect(checkMaintenance(mockRequest())).rejects.toThrow('Service is under maintenance')
  })

  it('allows admin users to bypass maintenance', async () => {
    const pubkey = 'a'.repeat(64)
    vi.mocked(getConfig).mockReturnValue({
      maintenance: { enabled: true },
    } as any)
    vi.mocked(validateNip98Auth).mockResolvedValue(pubkey)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: Role.ADMIN,
    } as any)

    await expect(checkMaintenance(mockRequest())).resolves.toBeUndefined()
  })

  it('blocks non-admin authenticated users during maintenance', async () => {
    const pubkey = 'b'.repeat(64)
    vi.mocked(getConfig).mockReturnValue({
      maintenance: { enabled: true },
    } as any)
    vi.mocked(validateNip98Auth).mockResolvedValue(pubkey)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: Role.OPERATOR,
    } as any)

    await expect(checkMaintenance(mockRequest())).rejects.toThrow(ServiceUnavailableError)
  })

  it('blocks users with no DB record during maintenance', async () => {
    vi.mocked(getConfig).mockReturnValue({
      maintenance: { enabled: true },
    } as any)
    vi.mocked(validateNip98Auth).mockResolvedValue('c'.repeat(64))
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

    await expect(checkMaintenance(mockRequest())).rejects.toThrow(ServiceUnavailableError)
  })
})
