'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useReceiveFlow, receiveActions } from '@/lib/client/wallet-flow-store'

export function ReceiveSummaryStep() {
  const router = useRouter()
  const flow = useReceiveFlow()

  useEffect(() => {
    if (!flow.invoice) {
      router.replace('/wallet/receive')
    }
  }, [flow.invoice, router])

  if (!flow.invoice) return null

  function done() {
    receiveActions.reset()
    router.replace('/wallet')
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-between px-4 pb-6 pt-10 text-center">
      <div className="flex flex-col items-center gap-6">
        <div className="flex size-20 items-center justify-center rounded-full bg-green-500/10 text-green-500">
          <Check className="size-10" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            Payment received
          </h1>
          <p className="text-sm text-muted-foreground">
            {flow.invoice.amountSats.toLocaleString()} sats landed in your
            wallet.
          </p>
        </div>

        {flow.invoice.description && (
          <p className="text-xs text-muted-foreground">
            “{flow.invoice.description}”
          </p>
        )}
      </div>

      <div className="flex w-full flex-col gap-2">
        <Button asChild variant="secondary" className="h-12 w-full">
          <Link href="/wallet/activity">View activity</Link>
        </Button>
        <Button onClick={done} className="h-12 w-full">
          Done
        </Button>
      </div>
    </div>
  )
}
