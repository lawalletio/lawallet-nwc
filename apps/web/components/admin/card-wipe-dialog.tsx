'use client'

import React, { useEffect, useState } from 'react'
import {
  ArrowRight,
  ChevronLeft,
  Copy,
  Eraser,
  Eye,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

type WipeData = {
  k0: string
  k1: string
  k2: string
  k3: string
  k4: string
  uid: string
}

/**
 * Two-step reset-and-remove dialog.
 *
 * Step 1 (reset) renders a BoltCard-spec QR pointing at this card's `/wipe`
 * endpoint. The BoltCard NFC Card Creator app scans it, fetches the
 * `{ action: 'wipe', k0..k4, uid }` payload, and resets the NTAG424 to factory
 * defaults so the card can be reused. The keys are NOT loaded up-front (they
 * never travel in the normal card responses any more) — the operator can
 * "Reveal reset keys" to fetch them for manual entry.
 *
 * **Fetching the keys (scanning the QR *or* revealing them) unpairs the card
 * from its user** — exporting a card's secrets means it can no longer be tied
 * to anyone. That happens server-side in `GET /api/cards/[id]/wipe`.
 *
 * Step 2 (confirm) is the deliberate, destructive removal: a separate
 * "Confirm removal" button deletes the DB record. Reset the physical card
 * first — once deleted, the reset payload is gone.
 *
 * The endpoint must be absolute so the phone app can reach the server from
 * outside the admin's browser; we derive `window.location.origin` after mount
 * to avoid an SSR hydration mismatch.
 */
export function CardWipeDialog({
  cardId,
  uid,
  open,
  onOpenChange,
  onConfirmDelete,
  deleting,
}: {
  cardId: string
  uid: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmDelete: () => void
  deleting: boolean
}) {
  const [origin, setOrigin] = useState<string | null>(null)
  const [step, setStep] = useState<'reset' | 'confirm'>('reset')
  const [wipeData, setWipeData] = useState<WipeData | null>(null)
  const [revealing, setRevealing] = useState(false)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const url = origin ? `${origin}/api/cards/${cardId}/wipe` : ''

  function handleOpenChange(next: boolean) {
    // Restart at the reset step and drop any revealed keys when reopened.
    if (!next) {
      setStep('reset')
      setWipeData(null)
    }
    onOpenChange(next)
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Could not copy')
    }
  }

  // Fetch the reset payload for manual entry. This call unpairs the card
  // server-side (it exports the keys), same as the phone app scanning the QR.
  async function revealKeys() {
    setRevealing(true)
    try {
      const res = await fetch(`/api/cards/${cardId}/wipe`)
      if (!res.ok) throw new Error(`Failed to load reset keys (${res.status})`)
      setWipeData(await res.json())
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load reset keys',
      )
    } finally {
      setRevealing(false)
    }
  }

  const keyJson = wipeData
    ? JSON.stringify(
        {
          action: 'wipe',
          k0: wipeData.k0,
          k1: wipeData.k1,
          k2: wipeData.k2,
          k3: wipeData.k3,
          k4: wipeData.k4,
          uid: wipeData.uid,
          version: 1,
        },
        null,
        2,
      )
    : ''

  const keyRows: [string, string][] = wipeData
    ? [
        ['UID', wipeData.uid],
        ['K0', wipeData.k0],
        ['K1', wipeData.k1],
        ['K2', wipeData.k2],
        ['K3', wipeData.k3],
        ['K4', wipeData.k4],
      ]
    : []

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 sm:max-w-[440px]">
        {step === 'reset' ? (
          <>
            <DialogHeader className="items-center text-center">
              <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-muted">
                <Eraser className="size-5 text-muted-foreground" aria-hidden />
              </div>
              <DialogTitle>Reset the card</DialogTitle>
              <DialogDescription>
                Scan with the BoltCard NFC Card Creator app (or any
                BoltCard-compatible tool) to reset the NTAG424 keys to factory
                defaults so the card can be reused. Scanning the QR or revealing
                the keys <strong>unpairs the card from its user</strong>.
              </DialogDescription>
            </DialogHeader>

            {/* `shrink-0` on each child: without it the flex column shrinks
                items below their natural size on short viewports (clipping the
                URL text vertically) instead of letting this area scroll. */}
            <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto py-3">
              <div className="shrink-0 rounded-lg bg-white p-3">
                {url ? (
                  <QRCodeSVG value={url} size={208} />
                ) : (
                  <div className="size-52 animate-pulse bg-muted/40" />
                )}
              </div>

              <div className="w-full shrink-0 overflow-hidden rounded-md border bg-muted/40 px-3 py-2">
                <p
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={url}
                >
                  {url || '…'}
                </p>
              </div>

              {/* Keys are revealed on demand (the fetch unpairs the card). */}
              {wipeData ? (
                <div className="w-full shrink-0 rounded-md border">
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      NTAG424 keys
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => copy(keyJson, 'Keys')}
                    >
                      <Copy className="mr-1.5 size-3.5" />
                      Copy JSON
                    </Button>
                  </div>
                  <div className="flex flex-col divide-y">
                    {keyRows.map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-center gap-2 px-3 py-1.5"
                      >
                        <span className="w-9 shrink-0 text-xs font-medium text-muted-foreground">
                          {label}
                        </span>
                        <code
                          className="flex-1 truncate font-mono text-xs"
                          title={value}
                        >
                          {value}
                        </code>
                        <button
                          type="button"
                          onClick={() => copy(value, label)}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label={`Copy ${label}`}
                        >
                          <Copy className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full shrink-0"
                  onClick={revealKeys}
                  disabled={revealing}
                >
                  {revealing ? (
                    <Spinner size={16} />
                  ) : (
                    <Eye className="mr-2 size-4" />
                  )}
                  Reveal reset keys (unpairs the card)
                </Button>
              )}
            </div>

            <DialogFooter className="gap-2 border-t pt-4 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button variant="theme" onClick={() => setStep('confirm')}>
                Continue
                <ArrowRight className="ml-1 size-4" />
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="items-center text-center">
              <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-destructive/10">
                <ShieldAlert className="size-5 text-destructive" aria-hidden />
              </div>
              <DialogTitle>Remove this card?</DialogTitle>
              <DialogDescription>
                This permanently removes the card and its NTAG424 keys from the
                system. This cannot be undone — make sure you reset the physical
                card first, as the keys can no longer be retrieved afterwards.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-center">
                <span className="text-xs text-muted-foreground">Card UID</span>
                <p className="font-mono text-sm">{uid}</p>
              </div>
            </div>

            <DialogFooter className="gap-2 border-t pt-4 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => setStep('reset')}
                disabled={deleting}
              >
                <ChevronLeft className="mr-1 size-4" />
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={onConfirmDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <Spinner size={16} />
                ) : (
                  <Trash2 className="mr-1 size-4" />
                )}
                Confirm removal
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
