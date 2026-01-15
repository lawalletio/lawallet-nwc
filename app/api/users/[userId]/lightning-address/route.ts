import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateNip98 } from '@/lib/nip98'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'

export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: { userId: string } }) => {
    const { pubkey: authenticatedPubkey } = await validateNip98(request)

    const { userId } = params
    const { username: _username } = await request.json()

    // Validate input
    if (!userId || !_username) {
      throw new ValidationError('User ID and username are required')
    }

    // Clean and validate username
    const username = _username.trim().toLowerCase()

    // Validate username format: alphanumeric characters only, max 16 characters
    if (!/^[a-z0-9]+$/.test(username)) {
      throw new ValidationError(
        'Username must contain only lowercase letters and numbers'
      )
    }

    if (username.length > 16) {
      throw new ValidationError('Username must be 16 characters or less')
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { lightningAddress: true }
    })

    if (!user) {
      throw new NotFoundError('User not found')
    }

    if (user.pubkey !== authenticatedPubkey) {
      throw new AuthorizationError('Not authorized to update this user')
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
      throw new ConflictError('Username is already taken by another user')
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
    await prisma.lightningAddress.create({
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
  }
)
