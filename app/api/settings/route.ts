import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthorizationError } from '@/types/server/errors'
import { settingsBodySchema } from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { authenticate } from '@/lib/auth/unified-auth'
import { validateNip98Auth } from '@/lib/admin-auth'

async function authenticateSettingsRequest(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    return validateNip98Auth(request)
  }

  const auth = await authenticate(request)
  return auth.pubkey
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Fetch all settings records from the database
  const settings = await getSettings()

  // Validate authentication (JWT or NIP-98). Unauthenticated users only get public settings.
  let authenticatedPubkey = ''
  try {
    authenticatedPubkey = await authenticateSettingsRequest(request)
  } catch {
    authenticatedPubkey = ''
  }

  if (!authenticatedPubkey || authenticatedPubkey !== settings.root) {
    return NextResponse.json({
      domain: settings.domain,
      endpoint: settings.endpoint,
    })
  }

  return NextResponse.json(settings)
})

export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')

  // Validate authentication (JWT or NIP-98)
  const authenticatedPubkey = await authenticateSettingsRequest(request)

  // Fetch all settings records from the database
  const settings = await getSettings(['root'])

  if (authenticatedPubkey !== settings.root) {
    throw new AuthorizationError('Not authorized to update settings')
  }

  const body = await validateBody(request, settingsBodySchema)

  const processedSettings = Object.entries(body).map(([name, value]) => ({
    name: name.trim().toLowerCase(),
    value,
  }))

  // Upsert each setting
  const upsertPromises = processedSettings.map(({ name, value }) =>
    prisma.settings.upsert({
      where: { name },
      update: { value },
      create: { name, value }
    })
  )

  await Promise.all(upsertPromises)

  return NextResponse.json({
    message: 'Settings updated successfully',
    count: processedSettings.length
  })
})
