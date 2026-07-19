'use client'

import { useState } from 'react'
import { AlertTriangle, Fingerprint } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { SecretKeyReveal } from '@/components/shared/secret-key-reveal'
import { useAuth } from '@/components/admin/auth-context'
import {
  exportManagedKey,
  translatePasskeyError
} from '@/lib/client/passkey-api'

interface ExportKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Reveals the server-custodied Nostr secret key. The export endpoint demands
 * a fresh passkey assertion on top of the session token, so the reveal
 * button triggers a Face ID / Touch ID prompt — a stolen session alone can
 * never exfiltrate the key. The fetched nsec lives only in component state
 * and is dropped when the dialog closes.
 */
export function ExportKeyDialog({ open, onOpenChange }: ExportKeyDialogProps) {
  const { jwt } = useAuth()
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [nsec, setNsec] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Drop the secret from memory the moment the dialog closes.
      setNsec(null)
      setAcknowledged(false)
      setBusy(false)
    }
    onOpenChange(next)
  }

  async function handleReveal() {
    if (!jwt) return
    setBusy(true)
    try {
      const result = await exportManagedKey(jwt)
      setNsec(result.nsec)
    } catch (err) {
      const passkeyError = translatePasskeyError(err)
      if (passkeyError.kind !== 'cancelled') {
        toast.error(passkeyError.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export secret key</DialogTitle>
          <DialogDescription>
            {nsec
              ? 'Store it offline — a password manager or paper backup.'
              : 'Your Nostr secret key is the master key to this account.'}
          </DialogDescription>
        </DialogHeader>

        {nsec ? (
          <div className="space-y-4">
            <SecretKeyReveal nsec={nsec} />
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => handleOpenChange(false)}
            >
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <div className="space-y-1 text-foreground">
                <p>
                  Anyone with this key fully controls your account and funds.
                  It never expires and can&apos;t be rotated.
                </p>
                <p className="text-muted-foreground">
                  You&apos;ll confirm with your passkey before it&apos;s
                  revealed.
                </p>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-border bg-card/50 p-4 text-sm text-foreground">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={v => setAcknowledged(v === true)}
                disabled={busy}
                className="mt-0.5"
              />
              <span className="leading-snug">
                I understand the risk and will store the key somewhere safe.
              </span>
            </label>

            <Button
              type="button"
              className="h-11 w-full"
              onClick={handleReveal}
              disabled={!acknowledged || busy}
            >
              {busy ? <Spinner size={16} /> : <Fingerprint className="size-4" />}
              {busy ? 'Waiting for your passkey…' : 'Reveal my key'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
