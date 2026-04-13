'use client'

import React from 'react'
import { Permission } from '@/lib/auth/permissions'
import { useAuth } from '@/components/admin/auth-context'

interface PermissionGuardProps {
  permission: Permission
  fallback?: React.ReactNode
  children: React.ReactNode
}

/**
 * Conditionally renders children if the user has the required permission.
 * Otherwise renders the fallback (or nothing).
 */
export function PermissionGuard({ permission, fallback = null, children }: PermissionGuardProps) {
  const { isAuthorized } = useAuth()

  if (!isAuthorized(permission)) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
