import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { Role } from './permissions'

/**
 * Resolves the role for an authenticated pubkey.
 * Checks the User record first, falls back to Settings root check for backwards compatibility.
 */
export async function resolveRole(pubkey: string): Promise<Role> {
  const user = await prisma.user.findUnique({
    where: { pubkey },
    select: { role: true },
  })

  if (user?.role && user.role !== 'USER') {
    return user.role as Role
  }

  // Backwards compatibility: check if pubkey is the root in Settings
  const settings = await getSettings(['root'])
  if (pubkey === settings.root) {
    return Role.ADMIN
  }

  return (user?.role as Role) ?? Role.USER
}
