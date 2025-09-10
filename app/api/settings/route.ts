import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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

export async function GET() {
  try {
    // Fetch all settings records from the database
    const settings = await prisma.settings.findMany({
      orderBy: {
        name: 'asc'
      }
    })

    // Transform the array into a JSON object where name is the key and value is the value
    const settingsObject = settings.reduce(
      (acc, setting) => {
        acc[setting.name] = setting.value
        return acc
      },
      {} as Record<string, string>
    )

    return NextResponse.json(settingsObject)
  } catch (error) {
    console.error('Error fetching settings:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate that body is an object
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 }
      )
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
      return NextResponse.json(
        {
          error: 'Validation errors',
          details: validationErrors
        },
        { status: 400 }
      )
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
  } catch (error) {
    console.error('Error upserting settings:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
