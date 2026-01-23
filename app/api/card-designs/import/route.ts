import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { mockCardDesignData } from '@/mocks/card-design'
import { getSettings } from '@/lib/settings'
import { validateAdminAuth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { InternalServerError, ValidationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'

export const POST = withErrorHandling(async (request: Request) => {
  await validateAdminAuth(request)
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
  const fetchedDesigns = (await res.json()).filter(
    (card: any) => card.communityId === community_id
  )
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
  const newDesigns = fetchedDesigns.filter(
    (design: { id: string }) => !existingIds.has(design.id)
  )
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
    newDesigns.map(
      (design: {
        id: any
        imageUrl: any
        description: any
        createdAt: any
      }) =>
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
