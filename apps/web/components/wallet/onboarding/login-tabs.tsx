'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BrandLogotype } from '@/components/ui/brand-logotype'
import { NostrConnectForm } from '@/components/shared/nostr-connect-form'

export function LoginTabs() {
  const router = useRouter()

  return (
    <div className="flex flex-1 flex-col justify-between py-8">
      <div className="flex flex-col items-center gap-8">
        <BrandLogotype width={120} height={28} className="h-7 w-auto" />

        <div className="w-full space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-foreground">Login</h1>
          <p className="text-sm text-muted-foreground">
            Sign in using your Nostr credentials.
          </p>
        </div>

        <div className="w-full">
          <NostrConnectForm
            submitLabel="Login"
            loadingLabel="Signing in..."
            onSuccess={() => router.replace('/wallet')}
          />
        </div>
      </div>

      <div className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">
          New to LaWallet?
        </p>
        <Link
          href="/wallet/create-account"
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          Create an account
        </Link>
      </div>
    </div>
  )
}
