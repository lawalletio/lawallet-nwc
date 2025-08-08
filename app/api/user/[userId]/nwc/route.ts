import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateNip98 } from '@/lib/nip98'

export async function PUT(
  request: Request,
  { params }: { params: { userId: string } }
) {
  try {
    const { pubkey: authenticatedPubkey } = await validateNip98(request)

    // Read the request body for our data
    const { nwcUri } = await request.json()

    const { userId } = params

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

    if (user.pubkey !== authenticatedPubkey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
