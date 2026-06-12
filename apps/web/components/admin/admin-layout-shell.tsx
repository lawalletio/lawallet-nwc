'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Database, RefreshCw } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import {
  SidebarProvider,
  SidebarInset,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/admin/auth-context'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { MobileTabBar } from '@/components/admin/mobile-tab-bar'
import { LoginModal } from '@/components/admin/login-modal'
import { MaintenanceGate } from '@/components/admin/maintenance-gate'
import { SetupBanner } from '@/components/admin/setup-banner'

interface DatabaseStatus {
  checking: boolean
  error: Error | null
}

function useDatabaseStatus(enabled: boolean): DatabaseStatus & { refetch: () => Promise<void> } {
  const [checking, setChecking] = useState(enabled)
  const [error, setError] = useState<Error | null>(null)

  const check = useCallback(async () => {
    if (!enabled) {
      setChecking(false)
      setError(null)
      return
    }

    setChecking(true)
    try {
      const response = await fetch('/api/health', { cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.database === 'down') {
        const detail = typeof body?.detail === 'string' ? `: ${body.detail}` : ''
        throw new Error(`${body?.message || 'Database server is not accessible'}${detail}`)
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Database server is not accessible'))
    } finally {
      setChecking(false)
    }
  }, [enabled])

  useEffect(() => {
    void check()
    if (!enabled) return
    const interval = window.setInterval(() => void check(), 5000)
    return () => window.clearInterval(interval)
  }, [check, enabled])

  return { checking, error, refetch: check }
}

function DatabaseUnavailable({
  error,
  checking,
  onRetry,
}: {
  error: Error
  checking: boolean
  onRetry: () => void
}) {
  return (
    <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center p-6">
      <div
        role="alert"
        className="w-full max-w-xl rounded-lg border border-destructive/40 bg-card p-6 shadow-sm"
      >
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-md bg-destructive/10 text-destructive">
            <Database className="size-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              <h1 className="text-base font-semibold">Database unavailable</h1>
            </div>
            <p className="break-words text-sm text-muted-foreground">
              {error.message}
            </p>
            <p className="text-xs text-muted-foreground">
              Navigation is disabled until the database connection is restored.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="outline" size="sm" onClick={onRetry} disabled={checking}>
            <RefreshCw className={`mr-2 size-4 ${checking ? 'animate-spin' : ''}`} />
            Retry
          </Button>
        </div>
      </div>
    </div>
  )
}

export function AdminLayoutShell({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const database = useDatabaseStatus(status === 'authenticated')
  const databaseDown = !!database.error
  const handleLoginOpenChange = useCallback(
    (open: boolean) => {
      if (!open) router.push('/')
    },
    [router]
  )

  useEffect(() => {
    if (databaseDown && pathname !== '/admin') {
      router.replace('/admin')
    }
  }, [databaseDown, pathname, router])

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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Unauthenticated - use the shared login modal so all sign-in flows stay
  // consistent across landing and admin entry points.
  if (status === 'unauthenticated') {
    return (
      <div className="min-h-dvh bg-background">
        <LoginModal open onOpenChange={handleLoginOpenChange} />
      </div>
    )
  }

  // Authenticated - render full layout. MaintenanceGate wraps children so
  // non-admin users see the maintenance screen while admins keep a banner
  // at the top and can still toggle the flag.
  return (
    <SidebarProvider>
      <AdminSidebar disabled={databaseDown} />
      {/* `min-w-0` on the SidebarInset main prevents flex children
          (wide tables, long URLs, stat cards) from expanding the layout
          past the viewport on narrow screens. Without it, a table's
          internal overflow:auto has nothing to clip against and the
          whole admin shell scrolls horizontally. */}
      <SidebarInset className="min-w-0">
        <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
          {database.error ? (
            <DatabaseUnavailable
              error={database.error}
              checking={database.checking}
              onRetry={() => void database.refetch()}
            />
          ) : (
            <>
              <SetupBanner />
              <MaintenanceGate>{children}</MaintenanceGate>
            </>
          )}
        </main>
      </SidebarInset>
      <MobileTabBar disabled={databaseDown} />
    </SidebarProvider>
  )
}
