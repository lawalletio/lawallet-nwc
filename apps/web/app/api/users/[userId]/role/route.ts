import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateNip98Auth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  Role,
  Permission,
  hasPermission,
} from '@/lib/auth/permissions'
import {
  AuthorizationError,
  ValidationError,
  NotFoundError,
} from '@/types/server/errors'
import { updateRoleSchema } from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'

const ROLE_HIERARCHY: Role[] = [Role.USER, Role.VIEWER, Role.OPERATOR, Role.ADMIN]

function getRoleLevel(role: Role): number {
  return ROLE_HIERARCHY.indexOf(role)
}

async function resolveCallerRole(pubkey: string): Promise<Role> {
  const user = await prisma.user.findUnique({
    where: { pubkey },
    select: { role: true },
  })
  return (user?.role as Role) ?? Role.USER
}

export const GET = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ userId: string }> }
  ) => {
    const pubkey = await validateNip98Auth(request)
    const { userId } = await params

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, pubkey: true, role: true },
    })

    if (!targetUser) {
      throw new NotFoundError('User not found')
    }

    // Allow if caller is the target user or has USERS_READ permission
    const callerRole = await resolveCallerRole(pubkey)
    const isSelf = targetUser.pubkey === pubkey
    if (!isSelf && !hasPermission(callerRole, Permission.USERS_READ)) {
      throw new AuthorizationError('Not authorized to view this user\'s role')
    }

    return NextResponse.json({
      userId: targetUser.id,
      role: targetUser.role,
    })
  }
)

export const PUT = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ userId: string }> }
  ) => {
    await checkRequestLimits(request, 'json')
    const pubkey = await validateNip98Auth(request)
    const { userId } = await params

    const callerRole = await resolveCallerRole(pubkey)
    if (!hasPermission(callerRole, Permission.USERS_MANAGE_ROLES)) {
      throw new AuthorizationError('Not authorized to manage roles')
    }

    const parsed = await validateBody(request, updateRoleSchema)

    const targetRole = parsed.role as Role

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, pubkey: true, role: true },
    })

    if (!targetUser) {
      throw new NotFoundError('User not found')
    }

    // Caller must have a higher role than the target role being assigned
    if (getRoleLevel(callerRole) <= getRoleLevel(targetRole) && targetRole !== Role.USER) {
      throw new AuthorizationError(
        'Cannot assign a role equal to or higher than your own'
      )
    }

    // Prevent self-demotion
    if (targetUser.pubkey === pubkey && getRoleLevel(targetRole) < getRoleLevel(callerRole)) {
      throw new AuthorizationError('Cannot lower your own role')
    }

    // Prevent removing last admin
    if (
      (targetUser.role as Role) === Role.ADMIN &&
      targetRole !== Role.ADMIN
    ) {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN' },
      })
      if (adminCount <= 1) {
        throw new ValidationError('Cannot remove the last admin')
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role: targetRole },
      select: { id: true, role: true },
    })

    return NextResponse.json({
      userId: updated.id,
      role: updated.role,
    })
  }
)
