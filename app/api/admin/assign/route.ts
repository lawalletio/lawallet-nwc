import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'
import { validateNip98Auth } from '@/lib/admin-auth'

export async function POST(request: Request) {
  try {
    // Validate authentication
    let authenticatedPubkey: string
    try {
      authenticatedPubkey = await validateNip98Auth(request)
    } catch (response) {
      if (response instanceof NextResponse) {
        return response
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if there is already a root user
    const existingRoot = await prisma.settings.findUnique({
      where: {
        name: 'root'
      }
    })

    // If there is already a root, only the existing root can reassign it
    if (existingRoot) {
      if (existingRoot.value !== authenticatedPubkey) {
        return NextResponse.json(
          { error: 'Only the existing root user can reassign the root role' },
          { status: 403 }
        )
      }
    }

    // Ensure user exists in the database
    const existingUser = await prisma.user.findUnique({
      where: {
        pubkey: authenticatedPubkey
      }
    })

    const user = existingUser || (await createNewUser(authenticatedPubkey))

    // Check if user is already the root
    const isAlreadyRoot =
      existingRoot && existingRoot.value === authenticatedPubkey

    if (isAlreadyRoot) {
      return NextResponse.json(
        {
          message: 'User is already the root',
          pubkey: authenticatedPubkey,
          userId: user.id
        },
        { status: 200 }
      )
    }

    // Create or update root setting entry
    await prisma.settings.upsert({
      where: {
        name: 'root'
      },
      update: {
        value: authenticatedPubkey
      },
      create: {
        name: 'root',
        value: authenticatedPubkey
      }
    })

    return NextResponse.json({
      message: 'Root role assigned successfully',
      pubkey: authenticatedPubkey,
      userId: user.id,
      isFirstRoot: !existingRoot
    })
  } catch (error) {
    console.error('Error in POST /api/root/assign:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET endpoint to check root status
export async function GET(request: Request) {
  try {
    // Validate authentication
    let authenticatedPubkey: string
    try {
      authenticatedPubkey = await validateNip98Auth(request)
    } catch (response) {
      if (response instanceof NextResponse) {
        return response
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is root
    const rootSetting = await prisma.settings.findUnique({
      where: {
        name: 'root'
      }
    })

    const isRoot = rootSetting && rootSetting.value === authenticatedPubkey
    const hasRoot = !!rootSetting

    return NextResponse.json({
      isRoot,
      pubkey: authenticatedPubkey,
      hasRoot,
      canAssignRoot: !hasRoot || isRoot
    })
  } catch (error) {
    console.error('Error in GET /api/root/assign:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
