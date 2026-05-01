/**
 * Authentication roles in ascending privilege.
 * USER < VIEWER < OPERATOR < ADMIN.
 */
export enum Role {
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER',
  USER = 'USER',
}

const ROLE_HIERARCHY: Role[] = [Role.USER, Role.VIEWER, Role.OPERATOR, Role.ADMIN]

/**
 * Granular permissions checked by RBAC guards. Each role maps to a fixed
 * subset via `ROLE_PERMISSIONS`; ADMIN gets every permission by definition.
 */
export enum Permission {
  SETTINGS_READ = 'settings:read',
  SETTINGS_WRITE = 'settings:write',
  USERS_READ = 'users:read',
  USERS_WRITE = 'users:write',
  USERS_MANAGE_ROLES = 'users:manage_roles',
  CARDS_READ = 'cards:read',
  CARDS_WRITE = 'cards:write',
  CARD_DESIGNS_READ = 'card_designs:read',
  CARD_DESIGNS_WRITE = 'card_designs:write',
  ADDRESSES_READ = 'addresses:read',
  ADDRESSES_WRITE = 'addresses:write',
  NTAGS_READ = 'ntags:read',
  NTAGS_WRITE = 'ntags:write',
  ACTIVITY_READ = 'activity:read',
}

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.ADMIN]: Object.values(Permission),
  [Role.OPERATOR]: [
    Permission.CARDS_READ,
    Permission.CARDS_WRITE,
    Permission.CARD_DESIGNS_READ,
    Permission.CARD_DESIGNS_WRITE,
    Permission.ADDRESSES_READ,
    Permission.ADDRESSES_WRITE,
    Permission.NTAGS_READ,
    Permission.NTAGS_WRITE,
    Permission.USERS_READ,
    Permission.ACTIVITY_READ,
  ],
  [Role.VIEWER]: [
    Permission.CARDS_READ,
    Permission.CARD_DESIGNS_READ,
    Permission.ADDRESSES_READ,
    Permission.NTAGS_READ,
    Permission.USERS_READ,
    Permission.SETTINGS_READ,
    Permission.ACTIVITY_READ,
  ],
  [Role.USER]: [],
}

/**
 * @returns `true` if `role` is granted `permission` via the static role→permission map.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

/**
 * Hierarchy check — `true` when `role` is at least as privileged as `requiredRole`.
 * @param role - The actor's resolved role.
 * @param requiredRole - The minimum role demanded by the caller.
 */
export function hasRole(role: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY.indexOf(role) >= ROLE_HIERARCHY.indexOf(requiredRole)
}

/**
 * @returns A defensive copy of the permissions assigned to `role`.
 */
export function getRolePermissions(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]]
}

/**
 * Type guard narrowing an arbitrary string to a known {@link Role}.
 */
export function isValidRole(value: string): value is Role {
  return Object.values(Role).includes(value as Role)
}
