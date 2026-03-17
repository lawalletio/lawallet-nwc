'use client'

import React from 'react'
import {
  SidebarProvider,
  SidebarInset,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/components/admin/auth-context'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

export function AdminLayoutShell({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()

  // Loading state - full page skeleton
  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh bg-background">
        {/* Sidebar skeleton */}
        <div className="hidden md:flex w-64 flex-col border-r border-border p-4 gap-4">
          <Skeleton className="h-8 w-32" />
          <div className="flex flex-col gap-2 mt-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
        {/* Main content skeleton */}
        <div className="flex-1 flex flex-col">
          <Skeleton className="h-[60px] w-full" />
          <div className="p-6 flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Unauthenticated - render nothing (login modal is shown by AdminProviders)
  if (status === 'unauthenticated') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="text-center">
          <div className="flex size-12 mx-auto items-center justify-center rounded-md bg-primary text-primary-foreground text-lg font-bold mb-4">
            LW
          </div>
          <p className="text-sm text-muted-foreground">LaWallet Admin</p>
        </div>
      </div>
    )
  }

  // Authenticated - render full layout
  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        <main className="flex flex-1 flex-col">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
