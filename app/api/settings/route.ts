import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { validateNip98Auth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthorizationError, ValidationError } from '@/types/server/errors'
import { settingsBodySchema } from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Fetch all settings records from the database
  const settings = await getSettings()

  // Validate authentication
  let authenticatedPubkey: string
  try {
    authenticatedPubkey = await validateNip98Auth(request)
  } catch {
    authenticatedPubkey = ''
  }

  if (!authenticatedPubkey || authenticatedPubkey !== settings.root) {
    return NextResponse.json({
      domain: settings.domain,
      endpoint: settings.endpoint
    })
  }

  return NextResponse.json(settings)
})

export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')
  // Validate authentication
  const authenticatedPubkey = await validateNip98Auth(request)

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
