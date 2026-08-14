'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LightningAddressInput } from '@/components/wallet/shared/lightning-address-input'
import { parseDestination } from '@/lib/client/nwc/parse-destination'
import {
  sendActions,
  type ResolvedRecipient
} from '@/lib/client/wallet-flow-store'
import { contactsActions } from '@/lib/client/contacts-store'

/**
 * Send-flow recipient step. The field itself — suggestions, saved recipients,
 * avatars, keyboard handling — is the shared {@link LightningAddressInput};
 * what stays here is what only the send flow does: resolve the destination
 * (which may be a bolt11 or LNURL, not just an address) and route onward.
 */
export function RecipientInput() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await submitRecipient(value)
  }

  async function submitRecipient(nextValue: string) {
    const trimmedValue = nextValue.trim()
    if (!trimmedValue) return

    setValue(trimmedValue)
    setError(null)
    setLoading(true)

    try {
      const destination = parseDestination(trimmedValue)

      const recipient: ResolvedRecipient = {
        raw: trimmedValue,
        destination
      }

      // If the destination is a LUD-16 address, try to hydrate the profile
      // for a nicer preview. Best effort — a failed fetch still lets the flow
      // continue with just the raw address.
      if (
        destination.kind === 'lnurl-pay' &&
        'address' in destination &&
        destination.address
      ) {
        try {
          const res = await fetch(destination.lnurlpUrl, {
            headers: { accept: 'application/json' }
          })
          if (res.ok) {
            const meta = await res.json()
            if (meta && typeof meta.metadata === 'string') {
              const metaArr = safeParseMetadata(meta.metadata)
              const textPlain = metaArr.find(
                ([k]) => k === 'text/plain' || k === 'text/identifier'
              )?.[1]
              const imageEntry = metaArr.find(([k]) => k.startsWith('image/'))
              recipient.profile = {
                name: textPlain,
                image: imageEntry
                  ? `data:${imageEntry[0]};base64,${imageEntry[1]}`
                  : null
              }
            }
          }
        } catch {
          // ignore — best effort
        }
      }

      sendActions.setRecipient(recipient)

      if (destination.kind === 'lnurl-pay' && destination.address) {
        contactsActions.upsertRecent({
          lightningAddress: destination.address,
          name: recipient.profile?.name ?? destination.username,
          avatarUrl: recipient.profile?.image ?? undefined
        })
        void contactsActions.hydrateNip05Profile(destination.address)
      }

      // If the invoice already carries an amount, skip the keypad.
      if (
        destination.kind === 'invoice' &&
        destination.amountSats !== null &&
        destination.amountSats > 0
      ) {
        sendActions.setAmount(destination.amountSats)
        router.push('/wallet/send/preview')
      } else {
        router.push('/wallet/send/amount')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid recipient'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-h-0 flex-1 flex-col overflow-hidden px-4"
    >
      <div className="shrink-0 space-y-2 pb-4">
        <label
          htmlFor="recipient"
          className="text-sm font-medium text-foreground"
        >
          To
        </label>
        <LightningAddressInput
          id="recipient"
          variant="inline"
          allowNonAddress
          value={value}
          onChange={next => {
            setValue(next)
            setError(null)
          }}
          onSelect={next => void submitRecipient(next)}
          placeholder="satoshi@lawallet.ar, lnbc…, lnurl…"
          disabled={loading}
          autoFocus
          className="h-12 text-base"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="relative z-10 -mx-4 shrink-0 border-t border-border/60 bg-background/90 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:mx-0 sm:border-t-0 sm:bg-transparent sm:px-0 sm:pb-6 sm:pt-4 sm:backdrop-blur-none">
        <Button
          type="submit"
          className="h-12 w-full"
          disabled={!value.trim() || loading}
        >
          Continue
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </form>
  )
}

function safeParseMetadata(raw: string): Array<[string, string]> {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter(
          (p): p is [string, string] => Array.isArray(p) && p.length >= 2
        )
      : []
  } catch {
    return []
  }
}
