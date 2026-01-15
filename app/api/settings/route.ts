import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { validateNip98Auth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthorizationError, ValidationError } from '@/types/server/errors'

// Validation function for setting names
function validateSettingName(name: string): string | null {
  // Trim the name
  const trimmed = name.trim()

  // Check if empty after trimming
  if (!trimmed) {
    return 'Setting name cannot be empty'
  }

  // Check length (max 32 characters)
  if (trimmed.length > 32) {
    return 'Setting name cannot exceed 32 characters'
  }

  // Check if only contains alphanumeric characters, hyphens, and underscores
  const validPattern = /^[a-z0-9_-]+$/
  if (!validPattern.test(trimmed)) {
    return 'Setting name can only contain lowercase letters, numbers, hyphens, and underscores'
  }

  return null
}

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
  // Validate authentication
  const authenticatedPubkey = await validateNip98Auth(request)

  // Fetch all settings records from the database
  const settings = await getSettings(['root'])

  if (authenticatedPubkey !== settings.root) {
    throw new AuthorizationError('Not authorized to update settings')
  }

  const body = await request.json()

  // Validate that body is an object
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object')
  }

  const settingsToUpsert = Object.entries(body)
  const validationErrors: string[] = []
  const processedSettings: Array<{ name: string; value: string }> = []

  // Validate and process each setting
  for (const [name, value] of settingsToUpsert) {
    // Validate name
    const nameError = validateSettingName(name)
    if (nameError) {
      validationErrors.push(`${name}: ${nameError}`)
      continue
    }

    // Validate value (must be string)
    if (typeof value !== 'string') {
      validationErrors.push(`${name}: Value must be a string`)
      continue
    }

    // Process the name (trim and lowercase)
    const processedName = name.trim().toLowerCase()

    processedSettings.push({
      name: processedName,
      value: value
    })
  }

  // Return validation errors if any
  if (validationErrors.length > 0) {
    throw new ValidationError('Validation errors', validationErrors)
  }

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
