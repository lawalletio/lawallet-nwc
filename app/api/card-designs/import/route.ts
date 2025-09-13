import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { mockCardDesignData } from '@/mocks/card-design'

export async function POST() {
  try {
    console.log('🌱 Starting card design import...')

    // Check if designs already exist to avoid duplicates
    const existingDesigns = await prisma.cardDesign.findMany({
      where: {
        id: {
          in: mockCardDesignData.map(design => design.id)
        }
      },
      select: { id: true }
    })

    const existingIds = new Set(existingDesigns.map(design => design.id))
    const newDesigns = mockCardDesignData.filter(
      design => !existingIds.has(design.id)
    )

    if (newDesigns.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All card designs already exist',
        imported: 0,
        skipped: mockCardDesignData.length
      })
    }

    // Import new designs
    const importedDesigns = await Promise.all(
      newDesigns.map(design =>
        prisma.cardDesign.create({
          data: {
            id: design.id,
            imageUrl: design.imageUrl,
            description: design.description,
            createdAt: design.createdAt,
            // Leave userId as null for global designs
            userId: null
          }
        })
      )
    )

    console.log(`✅ Imported ${importedDesigns.length} card designs`)

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

