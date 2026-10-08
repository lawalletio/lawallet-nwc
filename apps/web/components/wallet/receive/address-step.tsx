'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useApi } from '@/lib/client/hooks/use-api'
import { Button } from '@/components/ui/button'
import { useWalletNwcTransactions } from '@/components/wallet/nwc-provider'
import { QrDisplay } from '@/components/wallet/shared/qr-display'

const QR_CREDIT_MS = 1_800

interface UserMeResponse {
  lightningAddress: string | null
  effectiveNwcString: string | null
}

export function ReceiveAddressStep() {
  const { data: me, loading } = useApi<UserMeResponse>('/api/users/me')
  const [credit, setCredit] = useState<{
    id: string
    amountSats: number
  } | null>(null)

  useWalletNwcTransactions(tx => {
    if (tx.type !== 'incoming') return
    setCredit({ id: tx.paymentHash, amountSats: tx.amountSats })
  })

  useEffect(() => {
    if (!credit) return
    const timer = window.setTimeout(() => setCredit(null), QR_CREDIT_MS)
    return () => window.clearTimeout(timer)
  }, [credit])

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
          overlay={
            credit ? (
              <span
                key={credit.id}
                role="status"
                aria-atomic="true"
                className="animate-qr-credit pointer-events-none absolute inset-0 flex items-center justify-center text-3xl font-semibold tabular-nums text-green-600"
              >
                +{credit.amountSats.toLocaleString()}
              </span>
            ) : null
          }
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
