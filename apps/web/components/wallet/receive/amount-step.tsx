'use client'

import { useEffect, useState } from 'react'
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
import { useApi, invalidateApiPath } from '@/lib/client/hooks/use-api'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { resolveUserNwc } from '@/lib/client/wallet-nwc'
import { useAuth } from '@/components/admin/auth-context'
import { makeInvoice } from '@/lib/client/nwc'
import {
  useReceiveFlow,
  receiveActions,
} from '@/lib/client/wallet-flow-store'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

interface UserMeResponse {
  effectiveNwcString: string | null
  nwcString: string
}

export function ReceiveAmountStep() {
  const router = useRouter()
  const flow = useReceiveFlow()
  const { apiClient } = useAuth()
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const { data: settings } = useSettings()
  const effectiveNwc = resolveUserNwc(me)
  const autoCreate = settings?.lncurl_auto_create === 'true'

  const [value, setValue] = useState<string>(
    flow.amountSats ? String(flow.amountSats) : '0',
  )
  const [description, setDescription] = useState(flow.description)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    trackEvent(AnalyticsEvent.WALLET_RECEIVE_STARTED)
  }, [])

  const amount = parseKeypadValue(value)

  async function create() {
    if (amount === null) return
    setLoading(true)
    receiveActions.setAmount(amount)
    receiveActions.setDescription(description)
    try {
      // Auto-create on receive: no wallet yet but the operator auto-creates
      // them → mint an LNCurl wallet now, then re-read /me for its connection
      // string. Other surfaces refresh off the invalidated caches.
      let nwc = effectiveNwc
      if (!nwc && autoCreate) {
        await apiClient.post('/api/remote-wallets/lncurl', {})
        const fresh = await apiClient.get<UserMeResponse>('/api/users/me')
        nwc = resolveUserNwc(fresh)
        invalidateApiPath('/api/users/me')
        invalidateApiPath('/api/remote-wallets')
      }
      if (!nwc) {
        toast.error('No wallet connected')
        return
      }
      const invoice = await makeInvoice(nwc, amount, description)
      trackEvent(AnalyticsEvent.WALLET_RECEIVE_INVOICE_GENERATED)
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
          disabled={amount === null || loading || (!effectiveNwc && !autoCreate)}
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
