'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/client/hooks/use-api'
import { useAuth } from '@/components/admin/auth-context'

interface UserMe {
  userId: string
  lightningAddress: string | null
}

export function AddressBanner() {
  const router = useRouter()
  const { status } = useAuth()
  const { data: user, loading, error } = useApi<UserMe>(
    status === 'authenticated' ? '/api/users/me' : null
  )
  const [dismissed, setDismissed] = useState(false)

  // Never render the "claim your address" nudge when the fetch errored —
  // the page-level `<EndpointError>` banner communicates the real state, and
  // showing both would ask the user to register an address they may already
  // have but can't see because the DB is down.
  if (loading || dismissed || error || !user || user.lightningAddress) return null

  return (
    <div className="relative bg-card/60 dark:bg-card/40 dark:bg-gradient-to-br dark:from-primary/10 dark:to-transparent backdrop-blur-xl rounded-2xl p-6 border border-primary/20 shadow-xl shadow-black/5 dark:shadow-black/10 transition-all duration-300 ease-out animate-in slide-in-from-top-4">
      <div className="relative flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted/60">
          <Zap className="size-6 text-yellow-500" />
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          <div className="space-y-1 pr-8">
            <h3 className="text-base font-semibold text-foreground">
              Claim your Lightning Address
            </h3>
            <p className="text-sm text-muted-foreground">
              Register a lightning address to receive payments on this platform.
            </p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push('/admin/addresses/register')}
          >
            Register now
          </Button>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="absolute top-4 right-4 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
