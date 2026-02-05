import { describe, it, expect } from 'vitest'
import {
  Role,
  Permission,
  hasPermission,
  hasRole,
  getRolePermissions,
  isValidRole,
} from '@/lib/auth/permissions'

describe('hasPermission', () => {
  it('ADMIN has all permissions', () => {
    for (const perm of Object.values(Permission)) {
      expect(hasPermission(Role.ADMIN, perm)).toBe(true)
    }
  })

  it('USER has no permissions', () => {
    for (const perm of Object.values(Permission)) {
      expect(hasPermission(Role.USER, perm)).toBe(false)
    }
  })

  it('OPERATOR has CARDS_READ and CARDS_WRITE', () => {
    expect(hasPermission(Role.OPERATOR, Permission.CARDS_READ)).toBe(true)
    expect(hasPermission(Role.OPERATOR, Permission.CARDS_WRITE)).toBe(true)
  })

  it('OPERATOR does not have SETTINGS_READ or SETTINGS_WRITE', () => {
    expect(hasPermission(Role.OPERATOR, Permission.SETTINGS_READ)).toBe(false)
    expect(hasPermission(Role.OPERATOR, Permission.SETTINGS_WRITE)).toBe(false)
  })

  it('OPERATOR does not have USERS_WRITE or USERS_MANAGE_ROLES', () => {
    expect(hasPermission(Role.OPERATOR, Permission.USERS_WRITE)).toBe(false)
    expect(hasPermission(Role.OPERATOR, Permission.USERS_MANAGE_ROLES)).toBe(false)
  })

  it('OPERATOR has USERS_READ', () => {
    expect(hasPermission(Role.OPERATOR, Permission.USERS_READ)).toBe(true)
  })

  it('VIEWER has read permissions but not write', () => {
    expect(hasPermission(Role.VIEWER, Permission.CARDS_READ)).toBe(true)
    expect(hasPermission(Role.VIEWER, Permission.CARDS_WRITE)).toBe(false)
    expect(hasPermission(Role.VIEWER, Permission.SETTINGS_READ)).toBe(true)
    expect(hasPermission(Role.VIEWER, Permission.SETTINGS_WRITE)).toBe(false)
    expect(hasPermission(Role.VIEWER, Permission.USERS_READ)).toBe(true)
    expect(hasPermission(Role.VIEWER, Permission.USERS_WRITE)).toBe(false)
  })
})

describe('hasRole', () => {
  it('ADMIN has all roles', () => {
    expect(hasRole(Role.ADMIN, Role.ADMIN)).toBe(true)
    expect(hasRole(Role.ADMIN, Role.OPERATOR)).toBe(true)
    expect(hasRole(Role.ADMIN, Role.VIEWER)).toBe(true)
    expect(hasRole(Role.ADMIN, Role.USER)).toBe(true)
  })

  it('USER only has USER role', () => {
    expect(hasRole(Role.USER, Role.USER)).toBe(true)
    expect(hasRole(Role.USER, Role.VIEWER)).toBe(false)
    expect(hasRole(Role.USER, Role.OPERATOR)).toBe(false)
    expect(hasRole(Role.USER, Role.ADMIN)).toBe(false)
  })

  it('OPERATOR has OPERATOR, VIEWER, and USER', () => {
    expect(hasRole(Role.OPERATOR, Role.OPERATOR)).toBe(true)
    expect(hasRole(Role.OPERATOR, Role.VIEWER)).toBe(true)
    expect(hasRole(Role.OPERATOR, Role.USER)).toBe(true)
    expect(hasRole(Role.OPERATOR, Role.ADMIN)).toBe(false)
  })

  it('VIEWER has VIEWER and USER', () => {
    expect(hasRole(Role.VIEWER, Role.VIEWER)).toBe(true)
    expect(hasRole(Role.VIEWER, Role.USER)).toBe(true)
    expect(hasRole(Role.VIEWER, Role.OPERATOR)).toBe(false)
    expect(hasRole(Role.VIEWER, Role.ADMIN)).toBe(false)
  })
})

describe('getRolePermissions', () => {
  it('returns a copy (not the original array)', () => {
    const perms = getRolePermissions(Role.ADMIN)
    perms.push('fake' as Permission)
    expect(getRolePermissions(Role.ADMIN)).not.toContain('fake')
  })

  it('ADMIN gets all permissions', () => {
    const perms = getRolePermissions(Role.ADMIN)
    expect(perms).toEqual(expect.arrayContaining(Object.values(Permission)))
    expect(perms).toHaveLength(Object.values(Permission).length)
  })

  it('USER gets empty array', () => {
    expect(getRolePermissions(Role.USER)).toEqual([])
  })

  it('VIEWER gets correct permissions', () => {
    const perms = getRolePermissions(Role.VIEWER)
    expect(perms).toContain(Permission.CARDS_READ)
    expect(perms).toContain(Permission.SETTINGS_READ)
    expect(perms).not.toContain(Permission.CARDS_WRITE)
    expect(perms).not.toContain(Permission.SETTINGS_WRITE)
  })
})

describe('isValidRole', () => {
  it('returns true for valid roles', () => {
    expect(isValidRole('ADMIN')).toBe(true)
    expect(isValidRole('OPERATOR')).toBe(true)
    expect(isValidRole('VIEWER')).toBe(true)
    expect(isValidRole('USER')).toBe(true)
  })

  it('returns false for invalid strings', () => {
    expect(isValidRole('admin')).toBe(false)
    expect(isValidRole('SUPERADMIN')).toBe(false)
    expect(isValidRole('')).toBe(false)
    expect(isValidRole('user')).toBe(false)
  })
})
