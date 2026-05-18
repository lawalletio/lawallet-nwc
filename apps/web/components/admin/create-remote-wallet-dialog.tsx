'use client'

import React, { useState } from 'react'
import { Plus, Lock } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import {
  useRemoteWalletMutations,
  type RemoteWalletData,
} from '@/lib/client/hooks/use-remote-wallets'
import { ApiClientError } from '@/lib/client/api-client'

/**
 * Driver types known to the platform. `NWC` is the only one that's
 * implemented today — the others render as disabled preview options in
 * the picker so the user sees what's coming without us hiding the roadmap.
 */
const DRIVER_OPTIONS: ReadonlyArray<{
  value: RemoteWalletData['type']
  label: string
  enabled: boolean
  hint?: string
}> = [
  { value: 'NWC', label: 'NWC (Nostr Wallet Connect)', enabled: true },
  { value: 'LND', label: 'LND', enabled: false, hint: 'Coming soon' },
  { value: 'CLN', label: 'CLN', enabled: false, hint: 'Coming soon' },
  { value: 'BTCPAY', label: 'BTCPay Server', enabled: false, hint: 'Coming soon' },
]

const NWC_SCHEMES = ['nostr+walletconnect://', 'nostrwalletconnect://']

/**
 * Cheap client-side guard so we can disable the submit button until the
 * URI at least *looks* like an NWC pairing string. The server runs the
 * authoritative driver schema; this just keeps a typo from costing a
 * round-trip.
 */
function looksLikeNwcUri(uri: string): boolean {
  const trimmed = uri.trim()
  return NWC_SCHEMES.some(p => trimmed.startsWith(p))
}

interface CreateRemoteWalletDialogProps {
  /** Called after a successful create. Page passes its `refetch` here. */
  onCreated?: () => void
}

export function CreateRemoteWalletDialog({ onCreated }: CreateRemoteWalletDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<RemoteWalletData['type']>('NWC')
  const [connectionString, setConnectionString] = useState('')
  const [mode, setMode] = useState<'RECEIVE' | 'SEND_RECEIVE'>('RECEIVE')
  const [isDefault, setIsDefault] = useState(false)
  const { createWallet, loading } = useRemoteWalletMutations()

  const trimmedName = name.trim()
  const trimmedUri = connectionString.trim()
  const canSubmit =
    !loading &&
    trimmedName.length > 0 &&
    trimmedName.length <= 120 &&
    type === 'NWC' && // only NWC writes today; switch unlocks once other drivers ship
    trimmedUri.length > 0 &&
    looksLikeNwcUri(trimmedUri)

  function resetForm() {
    setName('')
    setType('NWC')
    setConnectionString('')
    setMode('RECEIVE')
    setIsDefault(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    try {
      await createWallet({
        name: trimmedName,
        type,
        config: { connectionString: trimmedUri, mode },
        isDefault,
      })
      toast.success('Wallet added')
      setOpen(false)
      resetForm()
      onCreated?.()
    } catch (err) {
      // Server hands back structured errors via `ApiClientError`. Map the
      // ones the user can actually act on; everything else falls through
      // to a generic toast so we don't expose internals.
      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          toast.error('A wallet with that name already exists')
          return
        }
        if (err.status === 400) {
          toast.error(err.message || 'Invalid wallet details')
          return
        }
      }
      toast.error(err instanceof Error ? err.message : 'Failed to add wallet')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" />
          Add wallet
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a wallet</DialogTitle>
          <DialogDescription>
            Connect an external Lightning wallet so your addresses and Cards
            can route payments through it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="wallet-name">Name</Label>
            <Input
              id="wallet-name"
              placeholder="e.g. Alby Hub"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={120}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="wallet-type">Type</Label>
            <Select value={type} onValueChange={v => setType(v as RemoteWalletData['type'])}>
              <SelectTrigger id="wallet-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DRIVER_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} disabled={!opt.enabled}>
                    <span className="flex items-center gap-2">
                      {!opt.enabled && <Lock className="size-3.5 text-muted-foreground" />}
                      <span>{opt.label}</span>
                      {opt.hint && (
                        <span className="text-xs text-muted-foreground">— {opt.hint}</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === 'NWC' && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="wallet-uri">Connection string</Label>
                <Textarea
                  id="wallet-uri"
                  placeholder="nostr+walletconnect://..."
                  value={connectionString}
                  onChange={e => setConnectionString(e.target.value)}
                  rows={3}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Paste the NWC pairing URI from your wallet (Alby, Mutiny,
                  Phoenix, …). It’s stored encrypted and never displayed
                  again.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="wallet-mode">Capabilities</Label>
                <Select value={mode} onValueChange={v => setMode(v as typeof mode)}>
                  <SelectTrigger id="wallet-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RECEIVE">Receive only</SelectItem>
                    <SelectItem value="SEND_RECEIVE">Send and receive</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose what this wallet is allowed to do — match the scopes
                  you granted when you generated the connection string.
                </p>
              </div>
            </>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="wallet-default" className="cursor-pointer">
                Set as default
              </Label>
              <p className="text-xs text-muted-foreground">
                Lightning addresses with no explicit wallet will route through
                this one.
              </p>
            </div>
            <Switch
              id="wallet-default"
              checked={isDefault}
              onCheckedChange={setIsDefault}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="gap-2">
              {loading && <Spinner className="size-4" />}
              Add wallet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
