'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useApi } from '@/lib/client/hooks/use-api'
import {
  useSendFlow,
  sendActions,
} from '@/lib/client/wallet-flow-store'
import { SwipeButton } from '@/components/ui/swipe-button'
import { pay } from '@/lib/client/nwc'

interface UserMeResponse {
  effectiveNwcString: string | null
}

export function SendPreviewStep() {
  const router = useRouter()
  const flow = useSendFlow()
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const effectiveNwc = me?.effectiveNwcString ?? null

  useEffect(() => {
    if (!flow.recipient || flow.amountSats === null) {
      router.replace('/wallet/send')
    }
  }, [flow.recipient, flow.amountSats, router])

  if (!flow.recipient || flow.amountSats === null) return null

  const recipientLabel =
    flow.recipient.profile?.name ?? flow.recipient.raw

  async function confirm() {
    if (!effectiveNwc) {
      toast.error('No wallet connected')
      return
    }
    try {
      const result = await pay(
        effectiveNwc,
        flow.recipient!.destination,
        flow.amountSats,
        flow.comment || undefined,
      )
      sendActions.setResult({
        preimage: result.preimage,
        feesPaidSats: result.feesPaidSats,
        amountSats: flow.amountSats!,
        recipient: recipientLabel,
      })
      router.replace('/wallet/send/summary')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment failed'
      sendActions.setError(message)
      toast.error(message)
    }
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <div className="flex-1 space-y-6 pt-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Sending
          </span>
          <div className="flex items-baseline gap-2 tabular-nums">
            <span className="text-5xl font-semibold text-foreground">
              {flow.amountSats.toLocaleString()}
            </span>
            <span className="text-lg text-muted-foreground">sats</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <Row label="To" value={recipientLabel} />
          <div className="my-3 border-t border-border/60" />
          <Row
            label="Type"
            value={labelForKind(flow.recipient.destination.kind)}
          />
          {flow.comment && (
            <>
              <div className="my-3 border-t border-border/60" />
              <Row label="Note" value={flow.comment} />
            </>
          )}
        </div>

        {flow.error && (
          <p className="text-center text-sm text-destructive">{flow.error}</p>
        )}
      </div>

      <SwipeButton
        label="Swipe to pay"
        activeLabel="Release to confirm"
        loadingLabel="Paying…"
        onConfirm={confirm}
        disabled={!effectiveNwc}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] break-all text-right text-foreground">
        {value}
      </span>
    </div>
  )
}

function labelForKind(kind: string): string {
  switch (kind) {
    case 'invoice':
      return 'Lightning invoice'
    case 'lnurl-pay':
      return 'Lightning address'
    case 'npub':
      return 'Nostr zap'
    default:
      return kind
  }
}
