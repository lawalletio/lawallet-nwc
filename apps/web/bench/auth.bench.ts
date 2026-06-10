import { bench, describe } from 'vitest'
import { createJwtToken, verifyJwtToken } from '@/lib/jwt'
import { Role, getRolePermissions } from '@/lib/auth/permissions'
import { generateNtag424Values } from '@/lib/ntag424'

/**
 * Micro-benchmarks for CPU-bound auth/card hot paths. Numbers are
 * machine-dependent — treat them as observational trends (CI uploads
 * bench-results/latest.json as an artifact; nothing gates on them).
 */

const SECRET = 'bench-secret-at-least-32-characters-long!'
const PUBKEY = 'npub1xyz123abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890'

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
  bench('createJwtToken — sign session token', () => {
    createJwtToken(claims, SECRET, options)
  })

  bench('verifyJwtToken — verify session token', () => {
    verifyJwtToken(token, SECRET, options)
  })
})

describe('RBAC (lib/auth/permissions.ts)', () => {
  bench('getRolePermissions(ADMIN)', () => {
    getRolePermissions(Role.ADMIN)
  })
})

describe('NTAG424 (lib/ntag424.ts)', () => {
  bench('generateNtag424Values — derive card key material', () => {
    generateNtag424Values('04a1b2c3d4e5f6')
  })
})
