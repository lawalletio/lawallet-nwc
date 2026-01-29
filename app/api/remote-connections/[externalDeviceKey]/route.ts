import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import type { LoginResponse, Skin } from '@/types/remote-connections'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ externalDeviceKey: string }> }) => {
    const { externalDeviceKey } = await params

    if (!externalDeviceKey) {
      throw new ValidationError('External device key is required')
    }

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

    // Get all card designs from the database
    const cardDesigns = await prisma.cardDesign.findMany({
      select: {
        id: true,
        imageUrl: true,
        description: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    // Transform card designs to skins
    const skins: Skin[] = cardDesigns.map(design => ({
      label: design.description,
      value: design.id,
      file: design.imageUrl
    }))

    // Get the lnurlw base URL from settings
    const lnurlwSettings = await getSettings(['endpoint'])
    const lnurlwBase = `${lnurlwSettings.endpoint}/api/`

    const response: LoginResponse = {
      lnurlwBase,
      skins
    }

    return NextResponse.json(response)
  }
)
