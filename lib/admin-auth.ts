import { validateNip98 } from '@/lib/nip98'
import { getSettings } from '@/lib/settings'
import { AuthenticationError, AuthorizationError } from '@/types/server/errors'

/**
 * Validates admin authentication using NIP-98 and checks if the pubkey matches settings.root
 * @param request - The incoming request
 * @returns Promise<string> - The authenticated pubkey if valid
 * @throws AuthenticationError | AuthorizationError
 */
export async function validateAdminAuth(request: Request): Promise<string> {
  // Validate NIP-98 authentication
  let authenticatedPubkey: string
  try {
    const { pubkey } = await validateNip98(request)
    authenticatedPubkey = pubkey
  } catch (error) {
    throw new AuthenticationError()
  }

  // Get the root pubkey from settings
  const settings = await getSettings(['root'])

  // Check if the authenticated pubkey matches the root pubkey
  if (authenticatedPubkey !== settings.root) {
    throw new AuthorizationError('Not authorized to access admin resources')
  }

  return authenticatedPubkey
}

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
 * Wraps an admin route handler with authentication
 * @param handler - The route handler function
 * @returns The wrapped handler with admin authentication
 */
export function withAdminAuth<T extends any[]>(
  handler: (request: Request, ...args: T) => Promise<NextResponse>
) {
  return async (request: Request, ...args: T): Promise<NextResponse> => {
    await validateAdminAuth(request)
    return handler(request, ...args)
  }
}
