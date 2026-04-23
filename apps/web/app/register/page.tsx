'use client'

import { Suspense, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/components/admin/auth-context'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { NostrConnectForm } from '@/components/shared/nostr-connect-form'
import { RegisterAddressFlow } from '@/components/register/register-address-flow'

function sanitizeUsername(raw: string | null): string {
  if (!raw) return ''
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
}

function RegisterPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { status } = useAuth()

  const initialUsername = useMemo(
    () => sanitizeUsername(searchParams.get('username')),
    [searchParams]
  )

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size={24} />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <div className="flex min-h-dvh items-start justify-center p-6 pt-16">
        <div className="w-full max-w-[420px] space-y-4">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div>
                <h1 className="text-lg font-semibold">
                  {initialUsername ? `Claim ${initialUsername}` : 'Register your address'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Connect your Nostr identity to continue.
                </p>
              </div>
              <NostrConnectForm submitLabel="Connect" loadingLabel="Connecting..." />
            </CardContent>
          </Card>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => router.push('/')}
          >
            <ArrowLeft className="mr-2 size-4" />
            Back to home
          </Button>
        </div>
      </div>
    )
  }

  return (
    <RegisterAddressFlow
      initialUsername={initialUsername || undefined}
      successCtaLabel="Go to Dashboard"
      onSuccessCta={() => router.push('/admin')}
    />
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size={24} />
      </div>
    }>
      <RegisterPageInner />
    </Suspense>
  )
}
