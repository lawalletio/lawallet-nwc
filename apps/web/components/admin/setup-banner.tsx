'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { useAuth } from '@/components/admin/auth-context'

export function SetupBanner() {
  const router = useRouter()
  const { role } = useAuth()
  const { data: settings, loading } = useSettings()
  const [dismissed, setDismissed] = useState(false)

  if (loading || dismissed || settings?.domain || role !== 'ADMIN') return null

  return (
    <div className="relative bg-card/60 dark:bg-card/40 dark:bg-gradient-to-br dark:from-primary/10 dark:to-transparent backdrop-blur-xl rounded-2xl p-6 border border-primary/20 shadow-xl shadow-black/5 dark:shadow-black/10 transition-all duration-300 ease-out animate-in slide-in-from-top-4">
      <div className="relative flex items-start gap-4">
        {/* Icon */}
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted/60">
          <Sparkles className="size-6 text-foreground" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="space-y-1 pr-8">
            <h3 className="text-base font-semibold text-foreground">
              Finish your domain configuration
            </h3>
            <p className="text-sm text-muted-foreground">
              Configure your domain so LaWallet can handle Nostr identities and Lightning Addresses
              for your community. It&apos;s automatic and takes less than 3 minutes.
            </p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push('/admin/settings?tab=infrastructure')}
          >
            Configure now
          </Button>
        </div>

        {/* Close button */}
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
