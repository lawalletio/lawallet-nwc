import { getConfig } from '@/lib/config'
import { validateNip98Auth } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/auth/permissions'
import { ServiceUnavailableError } from '@/types/server/errors'

/**
 * Checks if maintenance mode is enabled and throws ServiceUnavailableError if so.
 * Admins authenticated via NIP-98 bypass the maintenance check.
 */
export async function checkMaintenance(request: Request): Promise<void> {
  const config = getConfig(false)

  if (!config.maintenance.enabled) {
    return
  }

  // Attempt admin bypass via NIP-98 auth
  try {
    const pubkey = await validateNip98Auth(request)
    const user = await prisma.user.findUnique({
      where: { pubkey },
      select: { role: true },
    })

    if (user?.role === Role.ADMIN) {
      return
    }
  } catch {
    // Auth failed silently — not an admin, proceed to block
  }

  throw new ServiceUnavailableError('Service is under maintenance')
}
