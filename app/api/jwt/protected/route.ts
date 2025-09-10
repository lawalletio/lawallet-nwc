import { NextResponse } from 'next/server'
import {
  withJwtAuth,
  getUserIdFromRequest,
  getClaimFromRequest,
  hasClaim
} from '@/lib/jwt-auth'
import type { AuthenticatedRequest } from '@/lib/jwt-auth'

// Example protected endpoint that requires JWT authentication
async function protectedHandler(request: AuthenticatedRequest) {
  try {
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
  } catch (error) {
    console.error('Protected endpoint error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Wrap the handler with JWT authentication
export const GET = withJwtAuth(protectedHandler, {
  requiredClaims: ['role'] // Require 'role' claim to be present
})

export const POST = withJwtAuth(protectedHandler, {
  requiredClaims: ['role', 'permissions'] // Require both 'role' and 'permissions' claims
})

