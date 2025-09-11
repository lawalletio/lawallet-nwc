import { validateNip98 } from '@/lib/nip98'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'

export async function POST(request: Request) {
  try {
    // Validate authentication
    let authenticatedPubkey: string
    try {
      const { pubkey } = await validateNip98(request)
      authenticatedPubkey = pubkey
    } catch (error) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if there is already a root user
    const existingRoot = await prisma.settings.findUnique({
      where: {
        name: 'root'
      }
    })

    // If there is already a root, it cannot be changed
    if (existingRoot) {
      return NextResponse.json(
        { error: 'Root user already exists and cannot be changed' },
        { status: 403 }
      )
    }

    // Ensure user exists in the database
    const existingUser = await prisma.user.findUnique({
      where: {
        pubkey: authenticatedPubkey
      }
    })

    const user = existingUser || (await createNewUser(authenticatedPubkey))

    // Create root setting entry and update user role
    await prisma.$transaction([
      prisma.settings.create({
        data: {
          name: 'root',
          value: authenticatedPubkey
        }
      }),
      prisma.user.update({
        where: {
          pubkey: authenticatedPubkey
        },
        data: {
          role: 'root'
        }
      })
    ])

    return NextResponse.json({
      message: 'Root role assigned successfully',
      pubkey: authenticatedPubkey,
      userId: user.id
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
      const { pubkey } = await validateNip98(request)
      authenticatedPubkey = pubkey
    } catch (error) {
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
      canAssignRoot: !hasRoot
    })
  } catch (error) {
    console.error('Error in GET /api/root/assign:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
