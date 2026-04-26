'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { parseDestination } from '@/lib/client/nwc/parse-destination'
import { sendActions, type ResolvedRecipient } from '@/lib/client/wallet-flow-store'

export function RecipientInput() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const destination = parseDestination(value)

      const recipient: ResolvedRecipient = {
        raw: value.trim(),
        destination,
      }

      // If the destination is a LUD-16 address, try to hydrate the profile
      // for a nicer preview. Best effort — a failed fetch still lets the flow
      // continue with just the raw address.
      if (destination.kind === 'lnurl-pay' && 'address' in destination && destination.address) {
        try {
          const res = await fetch(destination.lnurlpUrl, {
            headers: { accept: 'application/json' },
          })
          if (res.ok) {
            const meta = await res.json()
            if (meta && typeof meta.metadata === 'string') {
              const metaArr = safeParseMetadata(meta.metadata)
              const textPlain = metaArr.find(
                ([k]) => k === 'text/plain' || k === 'text/identifier',
              )?.[1]
              const imageEntry = metaArr.find(([k]) => k.startsWith('image/'))
              recipient.profile = {
                name: textPlain,
                image: imageEntry ? `data:${imageEntry[0]};base64,${imageEntry[1]}` : null,
              }
            }
          }
        } catch {
          // ignore — best effort
        }
      }

      sendActions.setRecipient(recipient)

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
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 px-4 pb-6">
      <div className="space-y-2">
        <label
          htmlFor="recipient"
          className="text-sm font-medium text-foreground"
        >
          To
        </label>
        <Input
          id="recipient"
          value={value}
          onChange={e => {
            setValue(e.target.value)
            setError(null)
          }}
          placeholder="satoshi@lawallet.ar, lnbc…, lnurl…"
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-12 text-base"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="flex-1" />

      <Button
        type="submit"
        className="h-12 w-full"
        disabled={!value.trim() || loading}
      >
        Continue
        <ArrowRight className="size-4" />
      </Button>
    </form>
  )
}

function safeParseMetadata(raw: string): Array<[string, string]> {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((p): p is [string, string] => Array.isArray(p) && p.length >= 2)
      : []
  } catch {
    return []
  }
}
