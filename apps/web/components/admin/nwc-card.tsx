'use client'

import React, { useState } from 'react'
import { Plug, Check, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'
import { useAuth } from '@/components/admin/auth-context'

interface UserMe {
  userId: string
  lightningAddress: string | null
  nwcString: string
}

export function NwcCard() {
  const { status } = useAuth()
  const { data: me, refetch } = useApi<UserMe>(
    status === 'authenticated' ? '/api/users/me' : null
  )
  const { mutate, loading } = useMutation<{ nwcUri: string }, { nwc: string }>()

  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  // Don't show the card unless the user has a lightning address
  if (!me || !me.lightningAddress) return null

  const hasNwc = Boolean(me.nwcString)
  const showForm = !hasNwc || editing

  async function handleSave() {
    if (!me) return
    const trimmed = value.trim()
    if (!trimmed) {
      toast.error('NWC connection string is required')
      return
    }
    if (!trimmed.startsWith('nostr+walletconnect://')) {
      toast.error('NWC string must start with nostr+walletconnect://')
      return
    }
    try {
      await mutate('put', `/api/users/${me.userId}/nwc`, { nwcUri: trimmed })
      toast.success('NWC connection saved')
      setEditing(false)
      setValue('')
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save NWC')
    }
  }

  function handleCancel() {
    setEditing(false)
    setValue('')
  }

  function maskedNwc(nwc: string): string {
    // Show prefix + truncated middle + last 4 chars
    try {
      const url = new URL(nwc.replace('nostr+walletconnect://', 'https://'))
      return `…${url.host.slice(-12)}`
    } catch {
      return `…${nwc.slice(-8)}`
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
          <Plug className="size-5 text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">Wallet Connection (NWC)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasNwc
              ? 'Your wallet is connected and ready to receive payments.'
              : 'Connect a Nostr Wallet Connect (NWC) wallet to receive payments at your lightning address.'}
          </p>
        </div>
        {hasNwc && !editing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(true)
              setValue('')
            }}
          >
            <Pencil className="size-3.5 mr-1" />
            Change
          </Button>
        )}
      </div>

      {hasNwc && !editing && (
        <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
          <Check className="size-3.5 text-green-500 shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate">
            nostr+walletconnect://{maskedNwc(me.nwcString)}
          </span>
        </div>
      )}

      {showForm && (
        <div className="space-y-2">
          <Input
            type="password"
            placeholder="nostr+walletconnect://..."
            value={value}
            onChange={e => setValue(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground">
            Get a connection string from{' '}
            <a
              href="https://nwc.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Alby
            </a>
            , Mutiny, Primal, or any NWC-compatible wallet.
          </p>
          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="theme"
              onClick={handleSave}
              disabled={!value.trim() || loading}
              className="flex-1 sm:flex-none"
            >
              {loading ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Saving...
                </>
              ) : (
                'Save connection'
              )}
            </Button>
            {editing && (
              <Button
                variant="ghost"
                onClick={handleCancel}
                disabled={loading}
              >
                <X className="size-4 mr-1" />
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
