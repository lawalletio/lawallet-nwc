import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateNip98 } from '@/lib/nip98'
import { getSettings } from '@/lib/settings'

export async function PUT(
  request: Request,
  { params }: { params: { userId: string } }
) {
  try {
    const { pubkey: authenticatedPubkey } = await validateNip98(request)

    const { userId } = params
    const { username: _username } = await request.json()

    // Validate input
    if (!userId || !_username) {
      return NextResponse.json(
        { error: 'User ID and username are required' },
        { status: 400 }
      )
    }

    // Clean and validate username
    const username = _username.trim().toLowerCase()

    // Validate username format: alphanumeric characters only, max 16 characters
    if (!/^[a-z0-9]+$/.test(username)) {
      return NextResponse.json(
        { error: 'Username must contain only lowercase letters and numbers' },
        { status: 400 }
      )
    }

    if (username.length > 16) {
      return NextResponse.json(
        { error: 'Username must be 16 characters or less' },
        { status: 400 }
      )
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { lightningAddress: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (user.pubkey !== authenticatedPubkey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user already has a lightning address
    let oldLightningAddress = null
    if (user.lightningAddress) {
      oldLightningAddress = user.lightningAddress
    }

    // Check if username is already taken by another user
    const existingAddress = await prisma.lightningAddress.findUnique({
      where: { username }
    })

    if (existingAddress && existingAddress.userId !== userId) {
      return NextResponse.json(
        { error: 'Username is already taken by another user' },
        { status: 409 }
      )
    }

    const { domain } = await getSettings(['domain'])

    // If the user already has this exact username, return it
    if (oldLightningAddress && oldLightningAddress.username === username) {
      const completeAddress = `${username}@${domain}`
      return NextResponse.json({
        lightningAddress: completeAddress,
        username,
        domain,
        userId,
        replaced: null
      })
    }

    // Create the lightning address
    const lightningAddress = await prisma.lightningAddress.create({
      data: {
        username,
        userId
      }
    })

    // If there was an old lightning address, remove it
    if (oldLightningAddress) {
      await prisma.lightningAddress.delete({
        where: { username: oldLightningAddress.username }
      })
    }

    // Return the complete lightning address string
    const completeAddress = `${username}@${domain}`

    return NextResponse.json({
      lightningAddress: completeAddress,
      username,
      domain,
      userId,
      replaced: oldLightningAddress
        ? `${oldLightningAddress.username}@${domain}`
        : null
    })
  } catch (error) {
    console.error('Error creating lightning address:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
