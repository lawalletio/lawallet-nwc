'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { QrDisplay } from '@/components/wallet/shared/qr-display'

interface AddressShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  lightningAddress: string
  /** Optional avatar overlaid in the center of the QR. */
  avatarSrc?: string
}

/**
 * Modal that exposes the user's Lightning address as a scannable QR with
 * copy/share controls. Reachable from the home-screen address card's QR
 * icon button.
 */
export function AddressShareDialog({
  open,
  onOpenChange,
  lightningAddress,
  avatarSrc,
}: AddressShareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">Your address</DialogTitle>
          <DialogDescription className="text-center">
            Scan to send sats to your wallet, or share the link below.
          </DialogDescription>
        </DialogHeader>

        <QrDisplay
          value={lightningAddress}
          caption={lightningAddress}
          size={220}
          centerImage={avatarSrc}
        />
      </DialogContent>
    </Dialog>
  )
}
