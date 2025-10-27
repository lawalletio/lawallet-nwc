import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import type { LoginResponse, Skin } from '@/types/remote-connections'

export async function GET(
  request: Request,
  { params }: { params: { externalDeviceKey: string } }
) {
  try {
    const { externalDeviceKey } = params

    if (!externalDeviceKey) {
      return NextResponse.json(
        { error: 'External device key is required' },
        { status: 400 }
      )
    }

    // Get the external_device_key from settings
    const settings = await getSettings(['external_device_key'])
    const storedKey = settings.external_device_key

    if (!storedKey) {
      return NextResponse.json(
        { error: 'External device key not configured' },
        { status: 404 }
      )
    }

    // Verify the provided key matches the stored key
    if (externalDeviceKey !== storedKey) {
      return NextResponse.json(
        { error: 'Invalid external device key' },
        { status: 401 }
      )
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
  } catch (error) {
    console.error(
      'Error in GET /api/remote-connections/[externalDeviceKey]:',
      error
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
