export enum Role {
  ADMIN = 'admin',
  OPERATOR = 'operator',
  VIEWER = 'viewer',
  USER = 'user',
}

const ROLE_HIERARCHY: Role[] = [Role.USER, Role.VIEWER, Role.OPERATOR, Role.ADMIN]

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
  ],
  [Role.VIEWER]: [
    Permission.CARDS_READ,
    Permission.CARD_DESIGNS_READ,
    Permission.ADDRESSES_READ,
    Permission.NTAGS_READ,
    Permission.USERS_READ,
    Permission.SETTINGS_READ,
  ],
  [Role.USER]: [],
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export function hasRole(role: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY.indexOf(role) >= ROLE_HIERARCHY.indexOf(requiredRole)
}

export function getRolePermissions(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]]
}

export function isValidRole(value: string): value is Role {
  return Object.values(Role).includes(value as Role)
}
