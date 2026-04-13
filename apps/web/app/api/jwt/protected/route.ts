import { NextResponse } from 'next/server'
import {
  withJwtAuth,
  getUserIdFromRequest,
  getClaimFromRequest,
  hasClaim
} from '@/lib/jwt-auth'
import type { AuthenticatedRequest } from '@/lib/jwt-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { checkRequestLimits } from '@/lib/middleware/request-limits'

// Example protected endpoint that requires JWT authentication
async function protectedHandler(request: AuthenticatedRequest) {
  await checkRequestLimits(request, 'json')
  // Get user ID from the authenticated request
  const userId = getUserIdFromRequest(request)

  // Get additional claims if they exist
  const userRole = getClaimFromRequest<string>(request, 'role')
  const userPermissions = getClaimFromRequest<string[]>(
    request,
    'permissions'
  )

  // Check if user has specific claims
  const isAdmin = hasClaim(request, 'role', 'admin')
  const hasWriteAccess = hasClaim(request, 'permissions', 'write')

  // Your protected logic here
  const responseData = {
    message: 'Access granted to protected resource',
    userId,
    userRole,
    userPermissions,
    isAdmin,
    hasWriteAccess,
    timestamp: new Date().toISOString()
  }

  return NextResponse.json(responseData)
}

// Wrap the handler with JWT authentication
export const GET = withErrorHandling(
  withJwtAuth(protectedHandler, {
    requiredClaims: ['role'] // Require 'role' claim to be present
  })
)

export const POST = withErrorHandling(
  withJwtAuth(protectedHandler, {
    requiredClaims: ['role', 'permissions'] // Require both 'role' and 'permissions' claims
  })
)

