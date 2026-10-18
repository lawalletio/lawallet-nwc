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
import { LightningAddressInput } from '@/components/wallet/shared/lightning-address-input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useRemoteWalletForwardingMutations } from '@/lib/client/hooks/use-remote-wallet-forwarding'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import { useT } from '@/lib/client/i18n'

export function CreateProxyWalletDialog({
  wallets,
  onChanged
}: {
  wallets: RemoteWalletData[]
  onChanged: () => Promise<void>
}) {
  const t = useT()
  const tp = t.addresses.createProxy
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
      toast.success(tp.created)
      setOpen(false)
      setDestination('')
      await onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tp.enableFailed)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <GitBranch data-icon="inline-start" />
          {tp.title}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tp.title}</DialogTitle>
          <DialogDescription>{tp.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="proxy-wallet-source">{tp.sourceWallet}</Label>
            <select
              id="proxy-wallet-source"
              value={walletId}
              onChange={event => setWalletId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">{tp.selectWallet}</option>
              {selectable.map(wallet => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {tp.needNew}
              <CreateRemoteWalletDialog
                onCreated={async wallet => {
                  setWalletId(wallet.id)
                  await onChanged()
                }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="proxy-wallet-destination">
              {t.addresses.destination}
            </Label>
            <LightningAddressInput
              id="proxy-wallet-destination"
              placeholder="name@example.com"
              value={destination}
              onChange={setDestination}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="proxy-wallet-percent">{tp.entryFee}</Label>
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
              <Label htmlFor="proxy-wallet-base">{tp.baseFee}</Label>
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
            {t.common.cancel}
          </Button>
          <Button
            onClick={() => void configure()}
            disabled={!walletId || !destination.trim() || mutations.loading}
          >
            {mutations.loading && (
              <Spinner data-icon="inline-start" size={16} />
            )}
            {tp.enable}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
