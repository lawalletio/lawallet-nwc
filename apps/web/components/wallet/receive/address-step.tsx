'use client'

import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useApi } from '@/lib/client/hooks/use-api'
import { Button } from '@/components/ui/button'
import { QrDisplay } from '@/components/wallet/shared/qr-display'

interface UserMeResponse {
  lightningAddress: string | null
  effectiveNwcString: string | null
}

export function ReceiveAddressStep() {
  const { data: me, loading } = useApi<UserMeResponse>('/api/users/me')

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    )
  }

  if (!me?.lightningAddress) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          You don&apos;t have a Lightning address yet. Claim one to receive
          payments.
        </p>
        <Button asChild variant="secondary">
          <Link href="/wallet/claim-username">Claim a username</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <QrDisplay
          value={me.lightningAddress}
          caption={me.lightningAddress}
          uppercasePayload={false}
        />
      </div>

      <Button asChild variant="secondary" className="mt-6 h-12 w-full">
        <Link href="/wallet/receive/amount">
          <Plus className="size-4" />
          Request specific amount
        </Link>
      </Button>
    </div>
  )
}
