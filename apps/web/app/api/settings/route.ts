import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthorizationError, ValidationError } from '@/types/server/errors'
import { settingsBodySchema } from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { authenticate } from '@/lib/auth/unified-auth'
import { validateNip98Auth } from '@/lib/admin-auth'
import { eventBus } from '@/lib/events/event-bus'
import { probeLud21Support } from '@/lib/lnurl-probe'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

async function authenticateSettingsRequest(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    return validateNip98Auth(request)
  }

  const auth = await authenticate(request)
  return auth.pubkey
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Fetch all settings records from the database
  const settings = await getSettings()
  const endpoint = settings.endpoint ?? settings.subdomain
  const responseSettings = {
    ...settings,
    endpoint,
    subdomain: endpoint,
  }

  // Validate authentication (JWT or NIP-98). Unauthenticated users only get public settings.
  let authenticatedPubkey = ''
  try {
    authenticatedPubkey = await authenticateSettingsRequest(request)
  } catch {
    authenticatedPubkey = ''
  }

  if (!authenticatedPubkey || authenticatedPubkey !== settings.root) {
    // Public fields: domain/endpoint for lightning address resolution,
    // branding for a consistent look across all visitors, the
    // maintenance flag so clients can render the maintenance banner
    // without first being blocked by the maintenance middleware, and
    // the social_* handles so the Community About page works for any
    // visitor (they're contact links, not credentials).
    return NextResponse.json({
      domain: settings.domain,
      endpoint,
      subdomain: endpoint,
      brand_theme: settings.brand_theme,
      brand_rounding: settings.brand_rounding,
      community_name: settings.community_name,
      logotype_url: settings.logotype_url,
      isotypo_url: settings.isotypo_url,
      maintenance_enabled: settings.maintenance_enabled,
      social_whatsapp: settings.social_whatsapp,
      social_telegram: settings.social_telegram,
      social_discord: settings.social_discord,
      social_twitter: settings.social_twitter,
      social_website: settings.social_website,
      social_nostr: settings.social_nostr,
      social_email: settings.social_email,
    })
  }

  return NextResponse.json(responseSettings)
})

export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')

  // Validate authentication (JWT or NIP-98)
  const authenticatedPubkey = await authenticateSettingsRequest(request)

  // Fetch all settings records from the database
  const settings = await getSettings([
    'root',
    'registration_ln_address',
    'registration_price',
    'registration_ln_enabled',
    'maintenance_enabled',
  ])

  if (authenticatedPubkey !== settings.root) {
    throw new AuthorizationError('Not authorized to update settings')
  }

  const body = await validateBody(request, settingsBodySchema)

  // Precondition check: if paid registration is enabled after this save,
  // the configured LN address must be reachable, in-range for the price,
  // and expose LUD-21 `verify`. Probe when the address/price is changing
  // or when paid mode is being flipped on — otherwise we don't hit the
  // provider on unrelated setting updates.
  const effective = {
    enabled:
      (body.registration_ln_enabled ?? settings.registration_ln_enabled) === 'true',
    address:
      body.registration_ln_address ?? settings.registration_ln_address ?? '',
    price: body.registration_price ?? settings.registration_price ?? '21',
  }

  if (effective.enabled) {
    if (!effective.address.trim()) {
      throw new ValidationError(
        'Paid registration requires a payment LN address'
      )
    }

    const prevEnabled = settings.registration_ln_enabled === 'true'
    const addressChanged =
      body.registration_ln_address !== undefined &&
      body.registration_ln_address !== settings.registration_ln_address
    const priceChanged =
      body.registration_price !== undefined &&
      body.registration_price !== settings.registration_price
    const enablingNow = !prevEnabled

    if (enablingNow || addressChanged || priceChanged) {
      const priceSats = parseInt(effective.price, 10)
      if (!Number.isFinite(priceSats) || priceSats < 1) {
        throw new ValidationError('Registration price must be a positive integer (sats)')
      }
      await probeLud21Support(effective.address.trim(), priceSats)
    }
  }

  const processedSettings = Object.values(
    Object.entries(body).reduce(
      (acc, [name, value]) => {
        const normalizedName = name.trim().toLowerCase()
        const key = normalizedName === 'subdomain' ? 'endpoint' : normalizedName
        acc[key] = { name: key, value }
        return acc
      },
      {} as Record<string, { name: string; value: string }>
    )
  )

  // Upsert each setting
  const upsertPromises = processedSettings.map(({ name, value }) =>
    prisma.settings.upsert({
      where: { name },
      update: { value },
      create: { name, value }
    })
  )

  await Promise.all(upsertPromises)

  eventBus.emit({ type: 'settings:updated', timestamp: Date.now() })

  const changedKeys = processedSettings.map(s => s.name)
  logActivity.fireAndForget({
    category: 'SERVER',
    event: ActivityEvent.SERVER_SETTINGS_UPDATED,
    message: `Settings updated: ${changedKeys.join(', ')}`,
    metadata: { keys: changedKeys, changedBy: authenticatedPubkey },
  })

  // Detect a maintenance toggle flip and surface it distinctly — it's a
  // high-signal event operators want to see even when scrolling past the
  // general settings updates.
  const nextMaintenance = body.maintenance_enabled
  if (
    nextMaintenance !== undefined &&
    nextMaintenance !== settings.maintenance_enabled
  ) {
    logActivity.fireAndForget({
      category: 'SERVER',
      event: ActivityEvent.SERVER_MAINTENANCE_TOGGLED,
      level: 'WARN',
      message: `Maintenance mode ${nextMaintenance === 'true' ? 'ENABLED' : 'DISABLED'}`,
      metadata: {
        previous: settings.maintenance_enabled,
        next: nextMaintenance,
        changedBy: authenticatedPubkey,
      },
    })
  }

  return NextResponse.json({
    message: 'Settings updated successfully',
    count: processedSettings.length
  })
})
