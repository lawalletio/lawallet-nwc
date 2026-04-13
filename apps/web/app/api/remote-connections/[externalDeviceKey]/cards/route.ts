import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { generateNtag424Values } from '@/lib/ntag424'
import { randomBytes } from 'crypto'
import type {
  CreateCardRequest,
  InitializeCardResponse
} from '@/types/remote-connections'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
} from '@/types/server/errors'
import { externalDeviceKeyParam, createRemoteCardSchema } from '@/lib/validation/schemas'
import { validateParams, validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ externalDeviceKey: string }> }) => {
    await checkRequestLimits(request, 'json')
    const { externalDeviceKey } = validateParams(await params, externalDeviceKeyParam)
    const { designId, cardUID } = await validateBody(request, createRemoteCardSchema)

    // Get the external_device_key from settings
    const settings = await getSettings(['external_device_key'])
    const storedKey = settings.external_device_key

    if (!storedKey) {
      throw new NotFoundError('External device key not configured')
    }

    // Verify the provided key matches the stored key
    if (externalDeviceKey !== storedKey) {
      throw new AuthenticationError('Invalid external device key')
    }

    // Verify the design exists
    const design = await prisma.cardDesign.findUnique({
      where: { id: designId }
    })

    if (!design) {
      throw new NotFoundError('Card design not found')
    }

    // Check if a card with this UID already exists
    const existingCard = await prisma.card.findFirst({
      where: {
        ntag424: {
          cid: cardUID.toUpperCase().replace(/:/g, '')
        }
      }
    })

    if (existingCard) {
      throw new ConflictError('Card with this UID already exists')
    }

    // Generate ntag424 values using the cardUID as cid
    const serial = cardUID.toUpperCase().replace(/:/g, '')
    const ntag424Values = generateNtag424Values(serial)

    // Generate random 16-byte string for otc
    const otc = randomBytes(16).toString('hex')

    // Create the ntag424 record first
    const ntag424 = await prisma.ntag424.create({
      data: ntag424Values
    })

    // Then create the card and link it to the ntag424
    await prisma.card.create({
      data: {
        id: randomBytes(16).toString('hex'),
        designId,
        title: 'Remote Card',
        ntag424Cid: ntag424.cid, // Link to the created ntag424
        otc: otc // Set the random 16-byte string for otc
      } as any
    })

    // Create response in InitializeCardResponse format
    const response: InitializeCardResponse = {
      k0: ntag424.k0,
      k1: ntag424.k1,
      k2: ntag424.k2,
      k3: ntag424.k3,
      k4: ntag424.k4,
      privateUID: ntag424.cid
    }

    return NextResponse.json(response)
  }
)
