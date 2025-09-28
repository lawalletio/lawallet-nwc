import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { mockCardDesignData } from '@/mocks/card-design'
import { getSettings } from '@/lib/settings'

export async function POST() {
  try {
    console.info('🌱 Starting card design import...')

    const { is_community, community_id } = await getSettings([
      'is_community',
      'community_id'
    ])
    console.info('Fetched settings:', { is_community, community_id })

    if (!is_community || !community_id) {
      console.info('Community ID is not set. Aborting import.')
      return NextResponse.json(
        { success: false, message: 'Community ID is not set' },
        { status: 400 }
      )
    }

    console.info('Fetching card designs from veintiuno.lat...')
    const res = await fetch('https://veintiuno.lat/api/cards.json')
    if (!res.ok) {
      console.info(
        'Failed to fetch cards from veintiuno.lat. Status:',
        res.status
      )
      return NextResponse.json(
        { success: false, message: 'Failed to fetch cards from veintiuno.lat' },
        { status: res.status }
      )
    }
    const fetchedDesigns = (await res.json()).filter(
      (card: any) => card.communityId === community_id
    )
    console.info(
      `Fetched ${fetchedDesigns.length} designs for community ${community_id}`
    )

    // Check if designs already exist to avoid duplicates
    console.info('Checking for existing card designs in the database...')
    const existingDesigns = await prisma.cardDesign.findMany({
      where: {
        id: {
          in: mockCardDesignData.map(design => design.id)
        }
      },
      select: { id: true }
    })
    console.info(
      `Found ${existingDesigns.length} existing designs in the database.`
    )

    const existingIds = new Set(existingDesigns.map(design => design.id))
    const newDesigns = fetchedDesigns.filter(
      (design: { id: string }) => !existingIds.has(design.id)
    )
    console.info(`Identified ${newDesigns.length} new designs to import.`)

    if (newDesigns.length === 0) {
      console.info('All card designs already exist. Nothing to import.')
      return NextResponse.json({
        success: true,
        message: 'All card designs already exist',
        imported: 0,
        skipped: mockCardDesignData.length
      })
    }

    // Import new designs
    console.info('Importing new card designs...')
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

    console.info(
      `✅ Imported ${importedDesigns.length} card designs successfully.`
    )

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
  } catch (error) {
    console.info('Error importing card designs:', error)
    console.error('Error importing card designs:', error)

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to import card designs',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
