import { getSettings } from '@/lib/settings'
import { hasRole, Role } from '@/lib/auth/permissions'
import { AuthorizationError, PaymentRequiredError } from '@/types/server/errors'

type RegistrationSettings = {
  registration_user_enabled?: string
  registration_ln_enabled?: string
  registration_ln_address?: string
  registration_admin_bypass?: string
}

export const USER_REGISTRATION_DISABLED_MESSAGE =
  'Lightning Address user registration is disabled. Ask an admin to create an address.'

function assertUserRegistrationAllowed(
  actorRole: Role,
  settings: RegistrationSettings
): void {
  const userRegistrationEnabled =
    (settings.registration_user_enabled ?? 'true') === 'true'
  if (userRegistrationEnabled || hasRole(actorRole, Role.ADMIN)) return

  throw new AuthorizationError(USER_REGISTRATION_DISABLED_MESSAGE)
}

function assertPaidRegistrationSatisfied(
  actorRole: Role,
  settings: RegistrationSettings
): void {
  const paidEnabled =
    settings.registration_ln_enabled === 'true' &&
    !!settings.registration_ln_address?.trim()
  if (!paidEnabled) return

  const adminBypass = (settings.registration_admin_bypass ?? 'true') === 'true'
  const actorIsOperator = hasRole(actorRole, Role.OPERATOR)
  if (adminBypass && actorIsOperator) return

  throw new PaymentRequiredError(
    'Registration requires payment. Create an invoice via POST /api/invoices and claim it with the preimage.'
  )
}

/**
 * Shared gate for self-service Lightning Address registration. When disabled,
 * only ADMIN may create addresses; operators and regular users are blocked.
 */
export async function requireUserAddressRegistration(
  actorRole: Role
): Promise<void> {
  const settings = await getSettings(['registration_user_enabled'])
  assertUserRegistrationAllowed(actorRole, settings)
}

/**
 * Full Lightning Address creation policy. It first enforces the instance-wide
 * self-service toggle, then the optional paid-registration rule.
 */
export async function requireAddressRegistration(
  actorRole: Role
): Promise<void> {
  const settings = await getSettings([
    'registration_user_enabled',
    'registration_ln_enabled',
    'registration_ln_address',
    'registration_admin_bypass'
  ])

  assertUserRegistrationAllowed(actorRole, settings)
  assertPaidRegistrationSatisfied(actorRole, settings)
}
