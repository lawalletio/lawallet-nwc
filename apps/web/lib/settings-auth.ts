import { NextRequest } from 'next/server'
import { authenticate, authenticateWithPermission } from '@/lib/auth/unified-auth'
import { validateNip98Auth } from '@/lib/admin-auth'
import { hasPermission, Permission } from '@/lib/auth/permissions'
import { resolveRole } from '@/lib/auth/resolve-role'
import { AuthorizationError } from '@/types/server/errors'

export async function authenticateSettingsRequest(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    return validateNip98Auth(request)
  }

  const auth = await authenticate(request)
  return auth.pubkey
}

async function authenticateSettingsPermission(
  request: NextRequest,
  permission: Permission,
): Promise<string> {
  const authHeader = request.headers.get('authorization')

  if (authHeader) {
    const auth = await authenticateWithPermission(request, permission)
    return auth.pubkey
  }

  const pubkey = await validateNip98Auth(request)
  const role = await resolveRole(pubkey)
  if (!hasPermission(role, permission)) {
    throw new AuthorizationError('Not authorized to update settings')
  }

  return pubkey
}

export async function authenticateSettingsReadRequest(request: NextRequest): Promise<string> {
  return authenticateSettingsPermission(request, Permission.SETTINGS_READ)
}

export async function authenticateSettingsWriteRequest(request: NextRequest): Promise<string> {
  return authenticateSettingsPermission(request, Permission.SETTINGS_WRITE)
}
