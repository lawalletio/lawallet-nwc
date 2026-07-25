import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { mockCardDesignData } from '@/mocks/card-design'
import { getSettings } from '@/lib/settings'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'
import { InternalServerError, ValidationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { imageUrlSchema } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'

export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'large')
  await authenticateWithPermission(request, Permission.CARD_DESIGNS_WRITE)
  logger.info('Starting card design import')

  const { is_community, community_id } = await getSettings([
    'is_community',
    'community_id'
  ])
  logger.info({ is_community, community_id }, 'Fetched settings')

  if (!is_community || !community_id) {
    logger.warn('Community ID is not set. Aborting import.')
    throw new ValidationError('Community ID is not set')
  }

  logger.info('Fetching card designs from veintiuno.lat')
  const res = await fetch('https://veintiuno.lat/api/cards.json')
  if (!res.ok) {
    logger.error({ status: res.status }, 'Failed to fetch cards from veintiuno.lat')
    throw new InternalServerError('Failed to fetch cards from veintiuno.lat', {
      details: { status: res.status }
    })
  }
  // Validate every entry before it can reach the DB. The catalog is a remote
  // third party, so nothing from it is trusted: `imageUrl` must be an http(s)
  // URL within the stored-length budget, otherwise the entry is dropped. Rows
  // are filtered rather than the whole import failing, so one bad catalog
  // entry can't block the rest.
  const catalogEntry = z.object({
    id: z.string().min(1),
    communityId: z.string().optional(),
    imageUrl: imageUrlSchema,
    description: z.string().trim().min(1).max(120).catch('Imported card')
  })

  const payload = await res.json()
  const rawDesigns = Array.isArray(payload) ? payload : []
  const fetchedDesigns = rawDesigns.flatMap((card: unknown) => {
    const parsed = catalogEntry.safeParse(card)
    if (!parsed.success || parsed.data.communityId !== community_id) return []
    return [parsed.data]
  })
  const rejected =
    rawDesigns.filter((c: any) => c?.communityId === community_id).length -
    fetchedDesigns.length
  if (rejected > 0) {
    logger.warn({ rejected }, 'Skipped catalog entries with an unusable image URL')
  }
  logger.info({ count: fetchedDesigns.length, community_id }, 'Fetched designs for community')

  // Check if designs already exist to avoid duplicates
  logger.info('Checking for existing card designs in the database')
  const existingDesigns = await prisma.cardDesign.findMany({
    where: {
      id: {
        in: mockCardDesignData.map(design => design.id)
      }
    },
    select: { id: true }
  })
  logger.info({ count: existingDesigns.length }, 'Found existing designs in database')

  const existingIds = new Set(existingDesigns.map(design => design.id))
  const newDesigns = fetchedDesigns.filter(design => !existingIds.has(design.id))
  logger.info({ count: newDesigns.length }, 'Identified new designs to import')

  if (newDesigns.length === 0) {
    logger.info('All card designs already exist. Nothing to import.')
    return NextResponse.json({
      success: true,
      message: 'All card designs already exist',
      imported: 0,
      skipped: mockCardDesignData.length
    })
  }

  // Import new designs
  logger.info({ count: newDesigns.length }, 'Importing new card designs')
  const importedDesigns = await Promise.all(
    newDesigns.map(design =>
      prisma.cardDesign.create({
        data: {
          id: design.id,
          imageUrl: design.imageUrl,
          description: design.description,
          // Leave userId as null for global designs
          userId: null
        }
      })
    )
  )

  logger.info({ count: importedDesigns.length }, 'Imported card designs successfully')

  eventBus.emit({ type: 'designs:updated', timestamp: Date.now() })

  return NextResponse.json({
    success: true,
    message: `Successfully imported ${importedDesigns.length} card designs`,
    imported: importedDesigns.length,
    skipped: existingIds.size,
    designs: importedDesigns.map(design => ({
      id: design.id,
      imageUrl: design.imageUrl,
      description: design.description,
      createdAt: design.createdAt
    }))
  })
})
