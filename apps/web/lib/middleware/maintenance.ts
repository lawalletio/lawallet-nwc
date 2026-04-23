import { getConfig } from '@/lib/config'
import { validateNip98Auth } from '@/lib/admin-auth'
import { validateJwtFromRequest } from '@/lib/jwt'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { Role, isValidRole } from '@/lib/auth/permissions'
import { ServiceUnavailableError } from '@/types/server/errors'

/**
 * Checks if maintenance mode is enabled and throws ServiceUnavailableError if so.
 * Maintenance is on when either the `MAINTENANCE_MODE` env flag is true OR the
 * `maintenance_enabled` setting in the DB is 'true'. Admins authenticated via
 * NIP-98 or JWT bypass the check so they can keep using the dashboard (and
 * toggle maintenance back off).
 *
 * `GET /api/settings` is exempt so the client can always learn the maintenance
 * state to render its banner without first getting blocked by it.
 */
export async function checkMaintenance(request: Request): Promise<void> {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/api/settings') {
    return
  }

  const envEnabled = getConfig(false).maintenance.enabled

  let dbEnabled = false
  try {
    const settings = await getSettings(['maintenance_enabled'])
    dbEnabled = settings.maintenance_enabled === 'true'
  } catch {
    // DB unreachable — fall back to the env flag only.
  }

  if (!envEnabled && !dbEnabled) {
    return
  }

  // Admin bypass via NIP-98 (covered first so the existing behaviour and
  // unit tests keep working). We attempt validation unconditionally; if the
  // header is missing or invalid, the error is caught and we fall through.
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
    // Not a valid NIP-98 request — try JWT next.
  }

  // Admin bypass via JWT (Bearer). Role is read from the JWT claim itself so
  // we don't need a second DB round-trip for dashboard clients.
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const config = getConfig()
      if (config.jwt.enabled && config.jwt.secret) {
        const result = await validateJwtFromRequest(request, config.jwt.secret, {
          issuer: 'lawallet-nwc',
          audience: 'lawallet-users',
        })
        const role = isValidRole(result.payload.role)
          ? result.payload.role
          : null
        if (role === Role.ADMIN) {
          return
        }
      }
    } catch {
      // Invalid/expired JWT — block.
    }
  }

  throw new ServiceUnavailableError('Service is under maintenance')
}
