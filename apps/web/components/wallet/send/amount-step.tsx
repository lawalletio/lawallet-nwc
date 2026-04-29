'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AmountKeypad,
  parseKeypadValue,
} from '@/components/wallet/shared/amount-keypad'
import { AmountDisplay } from '@/components/wallet/shared/amount-display'
import { useSendFlow, sendActions } from '@/lib/client/wallet-flow-store'

export function SendAmountStep() {
  const router = useRouter()
  const flow = useSendFlow()
  const [value, setValue] = useState<string>(
    flow.amountSats ? String(flow.amountSats) : '0',
  )

  useEffect(() => {
    if (!flow.recipient) {
      router.replace('/wallet/send')
    }
  }, [flow.recipient, router])

  const amount = parseKeypadValue(value)
  const recipientLabel =
    flow.recipient?.profile?.name ?? flow.recipient?.raw ?? ''

  function next() {
    if (amount === null) return
    sendActions.setAmount(amount)
    router.push('/wallet/send/preview')
  }

  return (
    <div className="flex flex-1 flex-col px-4">
      {recipientLabel && (
        <p className="text-center text-sm text-muted-foreground">
          To <span className="text-foreground font-medium">{recipientLabel}</span>
        </p>
      )}

      <AmountDisplay value={value} />

      <AmountKeypad value={value} onChange={setValue} integerOnly />

      <div className="pt-6 pb-6">
        <Button
          type="button"
          onClick={next}
          disabled={amount === null}
          className="h-12 w-full"
        >
          Continue
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
