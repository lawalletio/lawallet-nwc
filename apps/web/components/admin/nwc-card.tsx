'use client'

import React, { useMemo, useState } from 'react'
import { Plug, Check, Pencil, X, Radio, Key, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'
import { useAuth } from '@/components/admin/auth-context'
import { parseNwc, truncatePubkey } from '@/lib/client/nwc'

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

  // Parse the NWC URI once per value change instead of on every render
  const parsedNwc = useMemo(
    () => (me?.nwcString ? parseNwc(me.nwcString) : null),
    [me?.nwcString]
  )

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

      {hasNwc && !editing && !parsedNwc && (
        <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
          <Check className="size-3.5 text-green-500 shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate">
            Connected (unable to parse details)
          </span>
        </div>
      )}

      {hasNwc && !editing && parsedNwc && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/40 px-3 py-3">
          <div className="flex items-center gap-2 text-xs">
            <Check className="size-3.5 text-green-500 shrink-0" />
            <span className="text-foreground font-medium">Connected</span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs pl-5">
            {parsedNwc.name && (
              <>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Tag className="size-3" />
                  Name
                </div>
                <span className="text-foreground truncate">{parsedNwc.name}</span>
              </>
            )}
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Key className="size-3" />
              Pubkey
            </div>
            <span className="text-foreground font-mono truncate" title={parsedNwc.pubkey}>
              {truncatePubkey(parsedNwc.pubkey)}
            </span>
            <div className="flex items-start gap-1.5 text-muted-foreground">
              <Radio className="size-3 mt-0.5" />
              Relay{parsedNwc.relays.length > 1 ? 's' : ''}
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              {parsedNwc.relays.length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                parsedNwc.relays.map((relay, i) => (
                  <span
                    key={i}
                    className="text-foreground font-mono truncate"
                    title={relay}
                  >
                    {relay}
                  </span>
                ))
              )}
            </div>
          </div>
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
