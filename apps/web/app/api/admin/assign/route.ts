import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateNip98Auth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthorizationError } from '@/types/server/errors'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { invalidateHotSettingsCache } from '@/lib/settings'

export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  // Validate authentication
  const authenticatedPubkey = await validateNip98Auth(request)

  // Check if there is already a root user
  const existingRoot = await prisma.settings.findUnique({
    where: {
      name: 'root'
    }
  })

  // If there is already a root, only the existing root can reassign it
  if (existingRoot && existingRoot.value !== authenticatedPubkey) {
    throw new AuthorizationError(
      'Only the existing root user can reassign the root role'
    )
  }

  // Ensure an account exists for this pubkey (any linked identity resolves
  // to its owning account); create one only when the pubkey is truly unknown.
  const existingAccount = await resolveAccountByPubkey(authenticatedPubkey)

  const user = existingAccount || (await createNewUser(authenticatedPubkey))

  // Check if user is already the root
  const isAlreadyRoot =
    existingRoot && existingRoot.value === authenticatedPubkey

  if (isAlreadyRoot) {
    return NextResponse.json({
      message: 'User is already the root',
      pubkey: authenticatedPubkey,
      userId: user.id
    })
  }

  // Create or update root setting entry and set user role
  await prisma.$transaction([
    prisma.settings.upsert({
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
    }),
    prisma.user.update({
      where: {
        id: user.id
      },
      data: {
        role: 'ADMIN'
      }
    })
  ])
  invalidateHotSettingsCache()

  return NextResponse.json({
    message: 'Root role assigned successfully',
    pubkey: authenticatedPubkey,
    userId: user.id,
    isFirstRoot: !existingRoot
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
    canAssignRoot: !hasRoot || isRoot
  })
})
