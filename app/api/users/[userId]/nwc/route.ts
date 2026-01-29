import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateNip98 } from '@/lib/nip98'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'

export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
    let authenticatedPubkey: string
    try {
      const result = await validateNip98(request)
      authenticatedPubkey = result.pubkey
    } catch (error) {
      throw new AuthenticationError()
    }

    // Read the request body for our data
    const { nwcUri } = await request.json()

    const { userId } = await params

    // Validate input
    if (!userId) {
      throw new ValidationError('User ID is required')
    }

    if (!nwcUri) {
      throw new ValidationError('NWC URI is required')
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    })

    if (!user) {
      throw new NotFoundError('User not found')
    }

    if (user.pubkey !== authenticatedPubkey) {
      throw new AuthorizationError('Not authorized to update this user')
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
  }
)
