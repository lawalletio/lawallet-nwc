'use client'

import React, { useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { NostrConnectForm } from '@/components/shared/nostr-connect-form'
import { useBrandLogotypes } from '@/lib/client/hooks/use-brand'

export function LoginPage() {
  const router = useRouter()
  const { logotype } = useBrandLogotypes()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') router.push('/')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [router])

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background px-4">
      <Link
        href="/"
        className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <X className="size-5" />
      </Link>

      <div className="w-[350px] space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <Image
            src={logotype}
            alt="LaWallet"
            width={120}
            height={36}
            unoptimized
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
