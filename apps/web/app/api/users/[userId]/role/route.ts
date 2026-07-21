import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { eventBus } from '@/lib/events/event-bus'
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
import { ActivityEvent, logActivity } from '@/lib/activity-log'

const ROLE_HIERARCHY: Role[] = [Role.USER, Role.VIEWER, Role.OPERATOR, Role.ADMIN]

function getRoleLevel(role: Role): number {
  return ROLE_HIERARCHY.indexOf(role)
}

export const GET = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ userId: string }> }
  ) => {
    const auth = await authenticate(request)
    const { userId } = await params

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, pubkey: true, role: true },
    })

    if (!targetUser) {
      throw new NotFoundError('User not found')
    }

    // Allow if caller is the target user or has USERS_READ permission.
    // Compared by account id so a secondary-pubkey session still counts.
    const me = await resolveAccountByPubkey(auth.pubkey)
    const isSelf = me?.id === targetUser.id
    if (!isSelf && !hasPermission(auth.role, Permission.USERS_READ)) {
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
    const auth = await authenticate(request)
    const { userId } = await params

    if (!hasPermission(auth.role, Permission.USERS_MANAGE_ROLES)) {
      throw new AuthorizationError('Not authorized to manage roles')
    }

    const callerRole = auth.role
    const pubkey = auth.pubkey

    const parsed = await validateBody(request, updateRoleSchema)

    const targetRole = parsed.role as Role

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, pubkey: true, role: true },
    })

    if (!targetUser) {
      throw new NotFoundError('User not found')
    }

    // Callers can assign any role up to and including their own — an ADMIN
    // (top of the hierarchy) can therefore grant ADMIN, while a lower role
    // could never mint one. Only assigning a role *above* yourself is blocked.
    if (getRoleLevel(targetRole) > getRoleLevel(callerRole)) {
      throw new AuthorizationError(
        'Cannot assign a role higher than your own'
      )
    }

    // Prevent self-demotion (account-id comparison: a secondary-pubkey
    // session is still "you")
    const me = await resolveAccountByPubkey(pubkey)
    if (me?.id === targetUser.id && getRoleLevel(targetRole) < getRoleLevel(callerRole)) {
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

    eventBus.emit({ type: 'users:updated', timestamp: Date.now() })

    logActivity.fireAndForget({
      category: 'USER',
      event: ActivityEvent.USER_ROLE_CHANGED,
      message: `Role changed for user ${updated.id}: ${targetUser.role} → ${updated.role}`,
      userId: updated.id,
      metadata: {
        previousRole: targetUser.role,
        newRole: updated.role,
        changedBy: pubkey,
      },
    })

    return NextResponse.json({
      userId: updated.id,
      role: updated.role,
    })
  }
)
