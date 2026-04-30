'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/admin/auth-context'

interface RegisterAddressBannerProps {
  lightningAddress: string | null
}

// Closable nudge for admins who haven't claimed a Lightning Address yet.
// Renders nothing once dismissed, or for non-admins, or once an address
// exists. The dismissal is intentionally session-only — if the admin
// reloads, the prompt comes back until they claim something.
export function RegisterAddressBanner({ lightningAddress }: RegisterAddressBannerProps) {
  const router = useRouter()
  const { role } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || role !== 'ADMIN' || lightningAddress) return null

  return (
    <div className="relative bg-card/60 dark:bg-card/40 dark:bg-gradient-to-br dark:from-yellow-500/10 dark:to-transparent backdrop-blur-xl rounded-2xl p-6 border border-yellow-500/20 shadow-xl shadow-black/5 dark:shadow-black/10 transition-all duration-300 ease-out animate-in slide-in-from-top-4">
      <div className="relative flex items-start gap-4">
        {/* Icon */}
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10">
          <Zap className="size-6 text-yellow-500" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="space-y-1 pr-8">
            <h3 className="text-base font-semibold text-foreground">
              Claim your first Lightning Address
            </h3>
            <p className="text-sm text-muted-foreground">
              You haven&apos;t set up a Lightning Address yet. Pick a username so
              you can start receiving payments and identifying yourself on Nostr.
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

        {/* Close button */}
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="absolute top-4 right-4 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
