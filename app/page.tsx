'use client'

import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ArrowRight, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'

export default function LandingPage() {
  const { status } = useAuth()
  const router = useRouter()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center gap-8 max-w-sm text-center">
        <Image
          src="/logos/lawallet.svg"
          alt="LaWallet"
          width={180}
          height={40}
          priority
        />

        <p className="text-muted-foreground">
          Lightning Addresses for Everyone
        </p>

        {status === 'loading' ? (
          <Spinner size={24} className="text-muted-foreground" />
        ) : status === 'authenticated' ? (
          <Button
            size="lg"
            onClick={() => router.push('/admin')}
            className="w-full"
          >
            Go to Dashboard
            <ArrowRight className="ml-2 size-4" />
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={() => router.push('/admin')}
            className="w-full"
          >
            <Zap className="mr-2 size-4" />
            Connect with Nostr
          </Button>
        )}
      </div>
    </div>
  )
}
