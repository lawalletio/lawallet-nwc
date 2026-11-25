'use client'

import React, { useState } from 'react'
import { Bitcoin, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAddressMutations } from '@/lib/client/hooks/use-wallet-addresses'

interface Props {
  username: string
  domain: string
  /** Stored silent payment address, or null. */
  current: string | null
  /** Server can publish BIP-353 records right now. */
  enabled: boolean
  isOwner: boolean
}

/**
 * BIP-353: attach a BIP-352 silent payment address to this lightning address.
 * Saving publishes `<user>.user._bitcoin-payment.<domain>` TXT on the
 * instance's DNS, so wallets resolve `₿user@domain` to it.
 */
export function SilentPaymentCard({
  username,
  domain,
  current,
  enabled,
  isOwner
}: Props) {
  const { setSilentPayment, savingSilentPayment } = useAddressMutations()
  // The parent keys this card on `current`, so a saved change remounts it.
  const [value, setValue] = useState(current ?? '')

  if (!enabled && !current) return null

  const bip353 = `₿${username}@${domain}`
  const trimmed = value.trim()
  const dirty = trimmed !== (current ?? '')
  const editable = isOwner && enabled

  async function save(next: string | null) {
    try {
      await setSilentPayment(username, next)
      toast.success(
        next ? 'Silent payment address published' : 'Silent payment removed'
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bitcoin className="size-4 text-muted-foreground" aria-hidden />
          Silent payments (BIP-353)
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Receive on-chain with a reusable silent payment address. Wallets that
          support BIP-353 can pay{' '}
          <span className="font-mono text-foreground">{bip353}</span>.
        </p>
        {current && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm break-all">{bip353}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Copy BIP-353 address"
              onClick={() => {
                navigator.clipboard?.writeText(bip353)
                toast.success('Copied')
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        )}
        {editable ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={e => {
              e.preventDefault()
              if (trimmed && dirty) void save(trimmed)
            }}
          >
            <Label htmlFor="sp-address">Silent payment address</Label>
            <Input
              id="sp-address"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="sp1q…"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              disabled={savingSilentPayment}
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={!trimmed || !dirty || savingSilentPayment}
              >
                {current ? 'Update' : 'Publish'}
              </Button>
              {current && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={savingSilentPayment}
                  onClick={() => void save(null)}
                >
                  Remove
                </Button>
              )}
            </div>
          </form>
        ) : (
          current && (
            <p className="font-mono text-xs break-all text-muted-foreground">
              {current}
            </p>
          )
        )}
      </CardContent>
    </Card>
  )
}
