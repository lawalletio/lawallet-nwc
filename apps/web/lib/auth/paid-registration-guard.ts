import { getSettings } from '@/lib/settings'
import { hasRole, Role } from '@/lib/auth/permissions'
import { PaymentRequiredError } from '@/types/server/errors'

/**
 * Shared gate for any endpoint that would create or swap a user's
 * Lightning Address. Throws `PaymentRequiredError` (402) when paid
 * registration is enabled and the actor does not qualify for the
 * admin/operator bypass. Callers should invoke this before writing
 * to `LightningAddress`.
 *
 * Paid mode is only considered "engaged" when both the toggle is on
 * AND a payment LN address is configured — matching the invoice route
 * which returns `{ free: true }` in that half-configured state.
 *
 * The paid path goes through POST /api/invoices → claim with preimage,
 * which bypasses this guard by construction (the claim route never
 * invokes it).
 */
export async function requirePaidRegistration(actorRole: Role): Promise<void> {
  const settings = await getSettings([
    'registration_ln_enabled',
    'registration_ln_address',
    'registration_admin_bypass',
  ])

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
