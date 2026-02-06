import { vi } from 'vitest'
import type { Nip98ValidationResult } from '@/lib/nip98'

// Mock admin auth validation
export function mockAdminAuth(pubkey?: string) {
  const mockPubkey = pubkey || 'a'.repeat(64)
  vi.mock('@/lib/admin-auth', () => ({
    validateAdminAuth: vi.fn().mockResolvedValue(mockPubkey),
    validateNip98Auth: vi.fn().mockResolvedValue(mockPubkey),
  }))
  return mockPubkey
}

// Mock NIP-98 validation
export function mockNip98(pubkey?: string) {
  const mockPubkey = pubkey || 'b'.repeat(64)
  vi.mock('@/lib/nip98', () => ({
    validateNip98: vi.fn().mockResolvedValue({
      pubkey: mockPubkey,
      event: {
        id: 'a'.repeat(64),
        pubkey: mockPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 27235,
        tags: [],
        content: '',
        sig: 'b'.repeat(128),
      },
    }),
  }))
  return mockPubkey
}

// Create a mock Nip98ValidationResult
export function createNip98Result(pubkey: string): Nip98ValidationResult {
  return {
    pubkey,
    event: {
      id: 'a'.repeat(64),
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 27235,
      tags: [],
      content: '',
      sig: 'b'.repeat(128),
    },
  }
}

// Create a mock JWT token payload
export function createJwtPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user_123',
    role: 'USER',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
}

// Create a mock Request object with headers
export function createMockRequest(
  url: string,
  options: RequestInit & { headers?: Record<string, string> } = {}
): Request {
  const { headers = {}, ...rest } = options
  return new Request(url, {
    ...rest,
    headers: new Headers(headers),
  })
}

// Create a mock Request with JSON body
export function createJsonRequest(
  url: string,
  body: unknown,
  options: RequestInit & { headers?: Record<string, string> } = {}
): Request {
  const { headers = {}, ...rest } = options
  return new Request(url, {
    method: 'POST',
    ...rest,
    headers: new Headers({
      'Content-Type': 'application/json',
      ...headers,
    }),
    body: JSON.stringify(body),
  })
}
