'use client'

import React from 'react'
import Image from 'next/image'
import { NostrConnectForm } from '@/components/shared/nostr-connect-form'

export function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-[350px] space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <Image
            src="/logos/lawallet.svg"
            alt="LaWallet"
            width={120}
            height={36}
            priority
          />
          <h1 className="text-2xl font-semibold">Admin login</h1>
          <p className="text-sm text-muted-foreground">
            Access your community control panel.
          </p>
        </div>

        <NostrConnectForm />
      </div>
    </div>
  )
}
