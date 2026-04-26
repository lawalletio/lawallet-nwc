'use client'

import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CommunityNoteCard() {
  return (
    <div className="flex flex-1 flex-col justify-between py-6">
      <div className="space-y-8 pt-10">
        <div className="flex justify-center">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-nwc-purple/10 text-nwc-purple">
            <Sparkles className="size-10" />
          </div>
        </div>

        <div className="space-y-3 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            Welcome to LaWallet
          </h1>
          <p className="text-sm text-muted-foreground">
            This wallet is part of a self-custodial community platform built
            on Lightning and Nostr. You hold your own keys, and every payment
            routes through your Nostr Wallet Connect connection.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4 text-sm text-muted-foreground space-y-2">
          <p className="font-medium text-foreground">A few things to know</p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>Your private key never leaves this device.</li>
            <li>You can claim a free Lightning address inside the wallet.</li>
            <li>Send and receive in sats without a custodian.</li>
          </ul>
        </div>
      </div>

      <Button asChild className="w-full h-12">
        <Link href="/wallet">Enter wallet</Link>
      </Button>
    </div>
  )
}
