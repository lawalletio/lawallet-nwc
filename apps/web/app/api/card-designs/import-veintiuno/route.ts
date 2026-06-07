import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'
import { InternalServerError, ValidationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { eventBus } from '@/lib/events/event-bus'

/**
 * Domain this importer is scoped to. lawallet.io is the canonical instance that
 * hosts the full veintiuno catalog, so the "Import from veintiuno.lat" button —
 * and this route — are only available there.
 */
const VEINTIUNO_DOMAIN = 'lawallet.io'

/**
 * Published card catalog, generated at build time from
 * github.com/veintiuno-lat/veintiuno-website (`src/data/cards.ts`) with
 * absolute image URLs.
 */
const CARDS_URL = 'https://veintiuno.lat/api/cards.json'

/** Designs imported from veintiuno are keyed with this id prefix. */
const VEINTIUNO_ID_PREFIX = 'veintiuno-'

interface VeintiunoCard {
  id: string
  imageUrl: string
  description?: string
  title?: string
  communityName?: string
  number?: string
}

/**
 * The design name (stored in `CardDesign.description`, which the UI shows as the
 * design name). Use the card's `title` — e.g. `#1 - BTC Isla - abstractlai` —
 * falling back to other fields only if a card has no title.
 */
function designName(card: VeintiunoCard): string {
  const label =
    card.title?.trim() ||
    card.description?.trim() ||
    [card.communityName, card.number].filter(Boolean).join(' ').trim() ||
    'Veintiuno card'
  return label.slice(0, 120)
}

/**
 * `POST /api/card-designs/import-veintiuno` — import the entire veintiuno.lat
 * card catalog (all communities, no filter). Upserts by design id: new designs
 * are inserted, existing ones have their image/description refreshed. Only
 * available when the instance `domain` is lawallet.io.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'large')
  await authenticateWithPermission(request, Permission.CARD_DESIGNS_WRITE)

  const { domain } = await getSettings(['domain'])
  if (domain !== VEINTIUNO_DOMAIN) {
    throw new ValidationError(
      `Importing the veintiuno.lat catalog is only available on ${VEINTIUNO_DOMAIN}`,
    )
  }

  logger.info('Fetching full card catalog from veintiuno.lat')
  const res = await fetch(CARDS_URL)
  if (!res.ok) {
    logger.error({ status: res.status }, 'Failed to fetch cards from veintiuno.lat')
    throw new InternalServerError('Failed to fetch cards from veintiuno.lat', {
      details: { status: res.status },
    })
  }

  const payload = (await res.json()) as unknown
  const cards = Array.isArray(payload) ? (payload as VeintiunoCard[]) : []
  // Keep only well-formed entries: an id and an absolute image URL.
  const valid = cards.filter(
    c => !!c?.id && typeof c.imageUrl === 'string' && /^https?:\/\//.test(c.imageUrl),
  )
  logger.info({ count: valid.length }, 'Fetched valid designs from catalog')

  if (valid.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No designs to import',
      imported: 0,
      updated: 0,
      total: 0,
    })
  }

  // Which ids already exist, so we can report imported vs updated counts.
  const existing = await prisma.cardDesign.findMany({
    where: { id: { in: valid.map(c => c.id) } },
    select: { id: true },
  })
  const existingIds = new Set(existing.map(d => d.id))

  // Upsert: insert new designs, refresh image/description on existing ones.
  // Global catalog designs are not owned by a user.
  await prisma.$transaction(
    valid.map(card =>
      prisma.cardDesign.upsert({
        where: { id: card.id },
        create: {
          id: card.id,
          imageUrl: card.imageUrl,
          description: designName(card),
          userId: null,
        },
        update: {
          imageUrl: card.imageUrl,
          description: designName(card),
        },
      }),
    ),
  )

  const imported = valid.filter(c => !existingIds.has(c.id)).length
  const updated = valid.length - imported

  eventBus.emit({ type: 'designs:updated', timestamp: Date.now() })
  logger.info({ imported, updated }, 'Imported veintiuno.lat catalog')

  return NextResponse.json({
    success: true,
    message: `Imported ${imported} new design${imported === 1 ? '' : 's'}, updated ${updated}`,
    imported,
    updated,
    total: valid.length,
  })
})

/**
 * `DELETE /api/card-designs/import-veintiuno` — remove designs imported from
 * veintiuno (id prefix `veintiuno-`). Designs still referenced by a card are
 * kept (the FK would block deletion anyway) and reported as skipped, so the
 * action is safe to run repeatedly. Available wherever designs were imported
 * (both this importer and the community Sync produce `veintiuno-` ids).
 */
export const DELETE = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.CARD_DESIGNS_WRITE)

  const where = { id: { startsWith: VEINTIUNO_ID_PREFIX } }
  const total = await prisma.cardDesign.count({ where })

  // Only delete designs no card depends on; the rest stay (and are reported).
  const { count: removed } = await prisma.cardDesign.deleteMany({
    where: { ...where, cards: { none: {} } },
  })
  const skipped = total - removed

  if (removed > 0) {
    eventBus.emit({ type: 'designs:updated', timestamp: Date.now() })
  }
  logger.info({ removed, skipped }, 'Removed veintiuno designs')

  return NextResponse.json({
    success: true,
    message:
      skipped > 0
        ? `Removed ${removed} imported design${removed === 1 ? '' : 's'}; kept ${skipped} still used by a card`
        : `Removed ${removed} imported design${removed === 1 ? '' : 's'}`,
    removed,
    skipped,
  })
})
