'use client'

import React from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
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
import { LightningAddressInput } from '@/components/wallet/shared/lightning-address-input'
import { isLightningAddress } from '@/lib/ln-address'
import {
  useVoucherMutations,
  type Voucher
} from '@/lib/client/hooks/use-vouchers'

/**
 * Hand a coupon to a lightning address.
 *
 * Two steps on purpose. Sending is irreversible — the recipient swaps the
 * nonce at the coupon service the moment they accept it, and there is no
 * protocol move that takes it back. A one-click send of something that behaves
 * like cash would be the wrong affordance.
 */
export function SendVoucherDialog({
  voucher,
  onSent
}: {
  voucher: Voucher
  onSent?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [address, setAddress] = React.useState('')
  const [comment, setComment] = React.useState('')
  const { sendVoucher, sending } = useVoucherMutations()

  // Re-seed on every open so a cancelled send never leaks into the next one.
  React.useEffect(() => {
    if (!open) return
    setAddress('')
    setComment('')
    setConfirming(false)
  }, [open])

  const valid = isLightningAddress(address.trim())

  async function handleSend() {
    try {
      await sendVoucher(voucher.id, {
        address: address.trim(),
        ...(comment.trim() ? { comment: comment.trim() } : {})
      })
      toast.success(`Sent to ${address.trim()}`)
      setOpen(false)
      onSent?.()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not send the voucher'
      )
      setConfirming(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => !sending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Send data-icon="inline-start" />
          Send
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {confirming ? 'Send this voucher?' : 'Send voucher'}
          </DialogTitle>
          <DialogDescription>
            {confirming
              ? 'This cannot be undone.'
              : `Hand “${voucher.name}” to someone by lightning address.`}
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              <span className="font-medium text-foreground">
                {voucher.name}
              </span>{' '}
              goes to{' '}
              <span className="font-mono text-foreground">
                {address.trim()}
              </span>
              .
            </p>
            {/* Not boilerplate: the recipient takes the coupon before they
                answer, so a dishonest one really can keep it and claim the
                send failed. Better said here than discovered later. */}
            <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
              A voucher is a code, not a balance — sending it is like handing
              over cash. Once the recipient takes it you cannot get it back,
              even if they say it failed. Only send to people you trust.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="voucher-recipient">Recipient</Label>
              <LightningAddressInput
                id="voucher-recipient"
                value={address}
                onChange={setAddress}
                placeholder="alice@wallet.example"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="voucher-comment">Message (optional)</Label>
              <Input
                id="voucher-comment"
                value={comment}
                onChange={event => setComment(event.target.value)}
                maxLength={200}
                placeholder="for the coffee"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={sending}
            onClick={() => (confirming ? setConfirming(false) : setOpen(false))}
          >
            {confirming ? 'Back' : 'Cancel'}
          </Button>
          {confirming ? (
            <Button type="button" onClick={handleSend} disabled={sending}>
              {sending ? <Spinner data-icon="inline-start" /> : null}
              Send it
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!valid}
              onClick={() => setConfirming(true)}
            >
              Continue
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
