import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSettings, invalidateHotSettingsCache } from '@/lib/settings'
import { getConfig } from '@/lib/config'
import { getListenerConfig } from '@/lib/listener-config'
import { withErrorHandling } from '@/types/server/error-handler'
import { ValidationError } from '@/types/server/errors'
import { settingsBodySchema } from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import {
  authenticateSettingsReadRequest,
  authenticateSettingsWriteRequest
} from '@/lib/settings-auth'
import { eventBus } from '@/lib/events/event-bus'
import { probeLud21Support } from '@/lib/lnurl-probe'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Fetch all settings records from the database
  const settings = await getSettings()
  const endpoint = settings.endpoint ?? settings.subdomain
  const hasRoot = Boolean(settings.root)
  const responseSettings = {
    ...settings,
    endpoint,
    subdomain: endpoint,
    hasRoot
  }

  // Validate authentication (JWT or NIP-98). Unauthenticated users only get public settings.
  let canReadFullSettings = false
  try {
    await authenticateSettingsReadRequest(request)
    canReadFullSettings = true
  } catch {
    canReadFullSettings = false
  }

  if (!canReadFullSettings) {
    // Public fields: domain/endpoint for lightning address resolution,
    // branding for a consistent look across all visitors, the
    // maintenance flag so clients can render the maintenance banner
    // without first being blocked by the maintenance middleware, and
    // the social_* handles so the Community About page works for any
    // visitor (they're contact links, not credentials).
    return NextResponse.json({
      domain: settings.domain,
      domain_verified: settings.domain_verified,
      endpoint,
      subdomain: endpoint,
      hasRoot,
      brand_theme: settings.brand_theme,
      brand_rounding: settings.brand_rounding,
      community_name: settings.community_name,
      logotype_url: settings.logotype_url,
      isotypo_url: settings.isotypo_url,
      community_cover_url: settings.community_cover_url,
      maintenance_enabled: settings.maintenance_enabled,
      // LNCurl flags are non-secret feature signals the wallet UI (open to
      // every authenticated user, not just admins/operators with SETTINGS_READ)
      // needs: `lncurl_enabled` gates the "Create LNCurl wallet" option, and
      // `lncurl_auto_create` tells the wallet to offer receive (auto-minting a
      // wallet) instead of an empty "no wallet connected" state.
      lncurl_enabled: settings.lncurl_enabled,
      lncurl_auto_create: settings.lncurl_auto_create,
      social_whatsapp: settings.social_whatsapp,
      social_telegram: settings.social_telegram,
      social_discord: settings.social_discord,
      social_twitter: settings.social_twitter,
      social_website: settings.social_website,
      social_nostr: settings.social_nostr,
      social_email: settings.social_email,
      gtag_id: settings.gtag_id
    })
  }

  // Computed NWC-listener keys (full response only — same audience as the
  // sidebar's SETTINGS_READ gate). `listener_enabled` is the EFFECTIVE state
  // (Settings DB merged over LISTENER_* env, incl. the env-auto default), the
  // *_source keys drive the "from environment" badges in the NWC Services
  // tab, and `listener_url_effective` lets the tab probe an env-provisioned
  // listener whose URL isn't stored in the DB. The env secret VALUE is never
  // exposed — only its source.
  const listener = await getListenerConfig()
  return NextResponse.json({
    ...responseSettings,
    listener_enabled: listener.enabled ? 'true' : 'false',
    listener_url_source: listener.urlSource,
    listener_secret_source: listener.secretSource,
    listener_url_effective: listener.url ?? ''
  })
})

export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')

  // Validate authentication (JWT or NIP-98)
  const authenticatedPubkey = await authenticateSettingsWriteRequest(request)

  // Fetch all settings records from the database
  const settings = await getSettings([
    'root',
    'registration_ln_address',
    'registration_price',
    'registration_ln_enabled',
    'maintenance_enabled',
    'listener_url',
    'listener_auth_secret'
  ])

  const body = await validateBody(request, settingsBodySchema)
  const shouldResetDomainVerification =
    body.domain !== undefined ||
    body.endpoint !== undefined ||
    body.subdomain !== undefined

  delete body.domain_verified
  if (shouldResetDomainVerification) {
    body.domain_verified = 'false'
  }

  // Precondition check: if paid registration is enabled after this save,
  // the configured LN address must be reachable, in-range for the price,
  // and expose LUD-21 `verify`. Probe when the address/price is changing
  // or when paid mode is being flipped on — otherwise we don't hit the
  // provider on unrelated setting updates.
  const effective = {
    enabled:
      (body.registration_ln_enabled ?? settings.registration_ln_enabled) ===
      'true',
    address:
      body.registration_ln_address ?? settings.registration_ln_address ?? '',
    price: body.registration_price ?? settings.registration_price ?? '21'
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
        throw new ValidationError(
          'Registration price must be a positive integer (sats)'
        )
      }
      await probeLud21Support(effective.address.trim(), priceSats)
    }
  }

  // NWC listener settings — validate before persisting so the DB never holds
  // a broken pairing. Empty strings are allowed (they mean "clear → fall
  // back to the LISTENER_* env vars").
  if (body.listener_url !== undefined && body.listener_url.trim() !== '') {
    let validListenerUrl = false
    try {
      const parsed = new URL(body.listener_url.trim())
      validListenerUrl =
        parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      validListenerUrl = false
    }
    if (!validListenerUrl) {
      throw new ValidationError('Listener URL must be a valid http(s) URL')
    }
  }
  if (
    body.listener_auth_secret !== undefined &&
    body.listener_auth_secret !== '' &&
    body.listener_auth_secret.length < 32
  ) {
    throw new ValidationError(
      'Listener shared secret must be at least 32 characters'
    )
  }
  if (body.listener_enabled === 'true') {
    // Enabling requires a resolvable url+secret from the merged view:
    // posted value → stored setting → env var. (Optional chaining: config
    // mocks in tests are partial.)
    const envListener = getConfig(false)?.listener
    const effectiveUrl =
      (body.listener_url ?? settings.listener_url)?.trim() || envListener?.url
    const effectiveSecret =
      (body.listener_auth_secret ?? settings.listener_auth_secret) ||
      envListener?.secret
    if (!effectiveUrl || !effectiveSecret) {
      throw new ValidationError(
        'Enabling the listener requires a listener URL and shared secret (set them below or via LISTENER_URL / LISTENER_AUTH_SECRET)'
      )
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
  invalidateHotSettingsCache()

  eventBus.emit({ type: 'settings:updated', timestamp: Date.now() })

  const changedKeys = processedSettings.map(s => s.name)

  // Listener pairing changed → refresh the /admin/listener dashboard too.
  if (changedKeys.some(key => key.startsWith('listener_'))) {
    eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })
  }

  // The root layout reads `gtag_id` server-side (see app/layout.tsx) and
  // every page inherits that layout. Without this revalidation the static
  // prerender keeps serving the build-time value (or `null` from a missing
  // DB) until the next deploy — operators expect "save → reload → script
  // updates" to just work.
  if (changedKeys.includes('gtag_id')) {
    revalidatePath('/', 'layout')
  }

  logActivity.fireAndForget({
    category: 'SERVER',
    event: ActivityEvent.SERVER_SETTINGS_UPDATED,
    message: `Settings updated: ${changedKeys.join(', ')}`,
    metadata: { keys: changedKeys, changedBy: authenticatedPubkey }
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
        changedBy: authenticatedPubkey
      }
    })
  }

  return NextResponse.json({
    message: 'Settings updated successfully',
    count: processedSettings.length
  })
})
