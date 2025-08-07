import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(
  request: Request,
  { params }: { params: { userId: string } }
) {
  try {
    const { userId } = params
    const { nwcUri } = await request.json()

    // Validate input
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    if (!nwcUri) {
      return NextResponse.json(
        { error: 'NWC URI is required' },
        { status: 400 }
      )
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Update the user's NWC URI
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { nwc: nwcUri }
    })

    return NextResponse.json({
      userId: updatedUser.id,
      nwcUri: updatedUser.nwc,
      updated: true
    })
  } catch (error) {
    console.error('Error updating NWC URI:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
