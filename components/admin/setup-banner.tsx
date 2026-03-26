'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/lib/client/hooks/use-settings'

export function SetupBanner() {
  const router = useRouter()
  const { data: settings, loading } = useSettings()
  const [dismissed, setDismissed] = useState(false)

  if (loading || dismissed || settings?.domain) return null

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
      {/* Diagonal gradient overlay */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          background: 'linear-gradient(135deg, hsl(var(--theme-400, var(--primary))) 0%, transparent 60%)',
        }}
      />

      <div className="relative flex items-start gap-4 p-5">
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
