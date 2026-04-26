'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSendFlow, sendActions } from '@/lib/client/wallet-flow-store'

export function SendSummaryStep() {
  const router = useRouter()
  const flow = useSendFlow()

  useEffect(() => {
    if (!flow.result) {
      router.replace('/wallet/send')
    }
  }, [flow.result, router])

  if (!flow.result) return null

  function done() {
    sendActions.reset()
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
            Payment sent
          </h1>
          <p className="text-sm text-muted-foreground">
            {flow.result.amountSats.toLocaleString()} sats sent to{' '}
            <span className="text-foreground">{flow.result.recipient}</span>.
          </p>
        </div>

        {flow.result.feesPaidSats > 0 && (
          <p className="text-xs text-muted-foreground">
            Fee: {flow.result.feesPaidSats.toLocaleString()} sats
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
