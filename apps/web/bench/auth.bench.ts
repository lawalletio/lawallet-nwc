import { describe, test } from 'vitest'
import { createJwtToken, verifyJwtToken } from '@/lib/jwt'
import { Role, getRolePermissions } from '@/lib/auth/permissions'
import { generateNtag424Values } from '@/lib/ntag424'

/**
 * Micro-benchmarks for CPU-bound auth/card hot paths. Numbers are
 * machine-dependent — treat them as observational trends (CI uploads
 * bench-results/latest.json as an artifact; nothing gates on them).
 *
 * Vitest 5 moved `bench` off the top-level export: it is a test-context
 * fixture available inside `test()` in files matched by `benchmark.include`.
 */

const SECRET = 'bench-secret-at-least-32-characters-long!'
const PUBKEY =
  'npub1xyz123abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890'

const claims = {
  userId: PUBKEY,
  pubkey: PUBKEY,
  role: Role.ADMIN,
  permissions: getRolePermissions(Role.ADMIN)
}

const options = {
  expiresIn: '1h',
  issuer: 'lawallet-nwc',
  audience: 'lawallet-users'
} as const

const token = createJwtToken(claims, SECRET, options)

describe('JWT (lib/jwt.ts)', () => {
  test('createJwtToken — sign session token', async ({ bench }) => {
    await bench('createJwtToken — sign session token', () => {
      createJwtToken(claims, SECRET, options)
    }).run()
  })

  test('verifyJwtToken — verify session token', async ({ bench }) => {
    await bench('verifyJwtToken — verify session token', () => {
      verifyJwtToken(token, SECRET, options)
    }).run()
  })
})

describe('RBAC (lib/auth/permissions.ts)', () => {
  test('getRolePermissions(ADMIN)', async ({ bench }) => {
    await bench('getRolePermissions(ADMIN)', () => {
      getRolePermissions(Role.ADMIN)
    }).run()
  })
})

describe('NTAG424 (lib/ntag424.ts)', () => {
  test('generateNtag424Values — derive card key material', async ({
    bench
  }) => {
    await bench('generateNtag424Values — derive card key material', () => {
      generateNtag424Values('04a1b2c3d4e5f6')
    }).run()
  })
})
