import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'
import { validateNip98Auth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthorizationError } from '@/types/server/errors'

export const POST = withErrorHandling(async (request: Request) => {
  // Validate authentication
  const authenticatedPubkey = await validateNip98Auth(request)

  // Check if there is already a root user
  const existingRoot = await prisma.settings.findUnique({
    where: {
      name: 'root'
    }
  })

  // If there is already a root, it cannot be changed
  if (existingRoot) {
    throw new AuthorizationError('Root user already exists and cannot be changed')
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
})

// GET endpoint to check root status
export const GET = withErrorHandling(async (request: Request) => {
  // Validate authentication
  const authenticatedPubkey = await validateNip98Auth(request)

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
})
