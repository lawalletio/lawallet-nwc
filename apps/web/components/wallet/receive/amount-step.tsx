'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  AmountKeypad,
  parseKeypadValue,
} from '@/components/wallet/shared/amount-keypad'
import { AmountDisplay } from '@/components/wallet/shared/amount-display'
import { useApi } from '@/lib/client/hooks/use-api'
import { makeInvoice } from '@/lib/client/nwc'
import {
  useReceiveFlow,
  receiveActions,
} from '@/lib/client/wallet-flow-store'

interface UserMeResponse {
  effectiveNwcString: string | null
}

export function ReceiveAmountStep() {
  const router = useRouter()
  const flow = useReceiveFlow()
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const effectiveNwc = me?.effectiveNwcString ?? null

  const [value, setValue] = useState<string>(
    flow.amountSats ? String(flow.amountSats) : '0',
  )
  const [description, setDescription] = useState(flow.description)
  const [loading, setLoading] = useState(false)

  const amount = parseKeypadValue(value)

  async function create() {
    if (amount === null) return
    if (!effectiveNwc) {
      toast.error('No wallet connected')
      return
    }
    setLoading(true)
    receiveActions.setAmount(amount)
    receiveActions.setDescription(description)
    try {
      const invoice = await makeInvoice(effectiveNwc, amount, description)
      receiveActions.setInvoice(invoice)
      router.push('/wallet/receive/invoice')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create invoice'
      receiveActions.setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <AmountDisplay value={value} />

      <AmountKeypad value={value} onChange={setValue} integerOnly disabled={loading} />

      <div className="pt-6 space-y-3">
        <Input
          placeholder="Add a note (optional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
          disabled={loading}
          className="h-11"
        />
        <Button
          type="button"
          onClick={create}
          disabled={amount === null || loading || !effectiveNwc}
          className="h-12 w-full"
        >
          {loading ? (
            <>
              <Spinner size={16} />
              Creating invoice…
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
