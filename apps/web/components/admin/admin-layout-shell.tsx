'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Database, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/admin/auth-context'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { MobileTabBar } from '@/components/admin/mobile-tab-bar'
import { LoginModal } from '@/components/admin/login-modal'
import { MaintenanceGate } from '@/components/admin/maintenance-gate'
import { SetupBanner } from '@/components/admin/setup-banner'
import { useVisibleInterval } from '@/lib/client/hooks/use-visible-interval'

interface DatabaseStatus {
  checking: boolean
  error: Error | null
}

const HEALTH_POLL_INTERVAL_MS = 25_000
// One failed probe is often a blip (deploy, cold start, flaky network), so
// the outage banner waits for a second consecutive failure, re-probed soon.
const FAILURES_BEFORE_DOWN = 2
const RECHECK_AFTER_FAILURE_MS = 3_000
const ADMIN_SIDEBAR_BREAKPOINT = 1024

export function useDatabaseStatus(
  enabled: boolean
): DatabaseStatus & { refetch: () => Promise<void> } {
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const failuresRef = useRef(0)
  const recheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const check = useCallback(async () => {
    if (recheckTimerRef.current) {
      clearTimeout(recheckTimerRef.current)
      recheckTimerRef.current = null
    }
    if (!enabled) {
      failuresRef.current = 0
      setError(null)
      return
    }

    try {
      const response = await fetch('/api/health', { cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.database === 'down') {
        const detail =
          typeof body?.detail === 'string' ? `: ${body.detail}` : ''
        throw new Error(
          `${body?.message || 'Database server is not accessible'}${detail}`
        )
      }
      failuresRef.current = 0
      setError(null)
    } catch (err) {
      // The browser being offline says nothing about the database.
      if (!navigator.onLine) return
      failuresRef.current += 1
      if (failuresRef.current >= FAILURES_BEFORE_DOWN) {
        setError(
          err instanceof Error
            ? err
            : new Error('Database server is not accessible')
        )
      } else {
        recheckTimerRef.current = setTimeout(
          () => void check(),
          RECHECK_AFTER_FAILURE_MS
        )
      }
    }
  }, [enabled])

  useEffect(() => {
    void check()
    return () => {
      if (recheckTimerRef.current) clearTimeout(recheckTimerRef.current)
    }
  }, [check])
  useVisibleInterval(() => void check(), HEALTH_POLL_INTERVAL_MS, enabled)

  const refetch = useCallback(async () => {
    setChecking(true)
    try {
      await check()
    } finally {
      setChecking(false)
    }
  }, [check])

  return { checking, error, refetch }
}

function DatabaseUnavailableBanner({
  error,
  checking,
  onRetry
}: {
  error: Error
  checking: boolean
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-3"
    >
      <Database className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="size-4 text-destructive" />
          Database unavailable
        </p>
        <p className="break-words text-xs text-muted-foreground">
          {error.message}. Changes may not save until the connection is
          restored.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={checking}>
        <RefreshCw
          className={`mr-2 size-4 ${checking ? 'animate-spin' : ''}`}
        />
        Retry
      </Button>
    </div>
  )
}

export function AdminLayoutShell({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()
  const database = useDatabaseStatus(status === 'authenticated')
  const databaseDown = !!database.error
  const handleLoginOpenChange = useCallback(
    (open: boolean) => {
      if (!open) router.push('/')
    },
    [router]
  )

  // Loading state - full page skeleton
  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh bg-background">
        {/* Sidebar skeleton */}
        <div className="hidden lg:flex w-64 flex-col border-r border-border p-4 gap-4">
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
    <SidebarProvider mobileBreakpoint={ADMIN_SIDEBAR_BREAKPOINT}>
      <AdminSidebar disabled={databaseDown} />
      {/* `min-w-0` on the SidebarInset main prevents flex children
          (wide tables, long URLs, stat cards) from expanding the layout
          past the viewport on narrow screens. Without it, a table's
          internal overflow:auto has nothing to clip against and the
          whole admin shell scrolls horizontally. */}
      <SidebarInset className="min-w-0">
        <main className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
          {/* A banner, not a replacement page: unmounting the children
              would throw away whatever form the admin was filling in. */}
          {database.error && (
            <DatabaseUnavailableBanner
              error={database.error}
              checking={database.checking}
              onRetry={() => void database.refetch()}
            />
          )}
          <SetupBanner />
          <MaintenanceGate>{children}</MaintenanceGate>
        </main>
      </SidebarInset>
      <MobileTabBar disabled={databaseDown} />
    </SidebarProvider>
  )
}
