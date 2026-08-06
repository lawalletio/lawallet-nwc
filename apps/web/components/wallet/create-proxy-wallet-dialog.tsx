'use client'

import React, { useState } from 'react'
import { GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import { CreateRemoteWalletDialog } from '@/components/admin/create-remote-wallet-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useRemoteWalletForwardingMutations } from '@/lib/client/hooks/use-remote-wallet-forwarding'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'

export function CreateProxyWalletDialog({
  wallets,
  onChanged
}: {
  wallets: RemoteWalletData[]
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [walletId, setWalletId] = useState('')
  const [destination, setDestination] = useState('')
  const [fee, setFee] = useState('0.50')
  const [baseFee, setBaseFee] = useState('1')
  const mutations = useRemoteWalletForwardingMutations(walletId)
  const selectable = wallets.filter(
    wallet => wallet.type === 'NWC' && wallet.status === 'ACTIVE'
  )

  async function configure() {
    if (!walletId || !destination.trim()) return
    try {
      await mutations.configure({
        feeBps: Math.round(Number(fee) * 100),
        baseFeeSats: Number(baseFee),
        enabled: true,
        destinations: [{ address: destination.trim(), allocationBps: 10_000 }]
      })
      toast.success('Proxy wallet created')
      setOpen(false)
      setDestination('')
      await onChanged()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not enable forwarding'
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <GitBranch data-icon="inline-start" />
          Create proxy wallet
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create proxy wallet</DialogTitle>
          <DialogDescription>
            Select an existing send-and-receive NWC wallet or connect a new one,
            then choose its first forwarding destination.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="proxy-wallet-source">Source wallet</Label>
            <select
              id="proxy-wallet-source"
              value={walletId}
              onChange={event => setWalletId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select a wallet</option>
              {selectable.map(wallet => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Need a new one?
              <CreateRemoteWalletDialog
                onCreated={async wallet => {
                  setWalletId(wallet.id)
                  await onChanged()
                }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="proxy-wallet-destination">Destination</Label>
            <Input
              id="proxy-wallet-destination"
              placeholder="name@example.com"
              value={destination}
              onChange={event => setDestination(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="proxy-wallet-percent">Entry fee (%)</Label>
              <Input
                id="proxy-wallet-percent"
                type="number"
                min="0"
                max="10"
                step="0.01"
                value={fee}
                onChange={event => setFee(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proxy-wallet-base">Base fee (sats)</Label>
              <Input
                id="proxy-wallet-base"
                type="number"
                min="0"
                step="1"
                value={baseFee}
                onChange={event => setBaseFee(event.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void configure()}
            disabled={!walletId || !destination.trim() || mutations.loading}
          >
            {mutations.loading && (
              <Spinner data-icon="inline-start" size={16} />
            )}
            Enable proxy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
