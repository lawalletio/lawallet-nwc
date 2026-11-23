import { validateNip98 } from '@/lib/nip98'
import { AuthenticationError, AuthorizationError } from '@/types/server/errors'
import { Role, hasRole } from '@/lib/auth/permissions'
import { resolveRole } from '@/lib/auth/resolve-role'

/**
 * Validates NIP-98 authentication only (without checking root permissions)
 * Used for endpoints that need authentication but have custom authorization logic
 * @param request - The incoming request
 * @returns Promise<string> - The authenticated pubkey if valid
 * @throws AuthenticationError
 */
export async function validateNip98Auth(request: Request): Promise<string> {
  try {
    const { pubkey } = await validateNip98(request)
    return pubkey
  } catch (error) {
    throw new AuthenticationError()
  }
}

/**
 * Validates NIP-98 auth and checks that the user has at least the required role.
 * @returns The authenticated pubkey
 */
export async function validateRoleAuth(
  request: Request,
  requiredRole: Role
): Promise<string> {
  const pubkey = await validateNip98Auth(request)
  const role = await resolveRole(pubkey)

  if (!hasRole(role, requiredRole)) {
    throw new AuthorizationError('Not authorized to access this resource')
  }

  return pubkey
}

/**
 * Validates admin authentication using NIP-98 and checks if the pubkey matches settings.root
 * @param request - The incoming request
 * @returns Promise<string> - The authenticated pubkey if valid
 * @throws AuthenticationError | AuthorizationError
 */
export async function validateAdminAuth(request: Request): Promise<string> {
  return validateRoleAuth(request, Role.ADMIN)
}
