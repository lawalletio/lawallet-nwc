'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Nfc } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { DesignImage } from '@/components/admin/design-image'
import {
  NfcScanDialog,
  isWebNfcSupported,
} from '@/components/admin/nfc-scan-dialog'
import { useDesigns } from '@/lib/client/hooks/use-designs'
import { useCardMutations } from '@/lib/client/hooks/use-cards'
import { formatCardId, isValidCardId } from '@/lib/client/nfc-card-id'

interface CreateCardDialogProps {
  onSuccess?: () => void
}

export function CreateCardDialog({ onSuccess }: CreateCardDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [cardId, setCardId] = useState('')
  const [designId, setDesignId] = useState<string>('')
  const [scanOpen, setScanOpen] = useState(false)
  const { data: designs } = useDesigns()
  const { createCard, loading } = useCardMutations()

  // Only offer active designs when creating a new card — archived designs
  // stay in the catalogue (and already-linked cards keep rendering them
  // correctly on their detail page) but they shouldn't be selectable for
  // new hardware.
  const activeDesigns = designs?.filter(d => !d.archivedAt) ?? []
  const selectedDesign = activeDesigns.find(d => d.id === designId) ?? null

  const trimmedCardId = cardId.trim()
  // Treat empty as valid while the user hasn't typed anything yet — the
  // submit-time check below still blocks an empty ID.
  const cardIdInvalid = trimmedCardId !== '' && !isValidCardId(trimmedCardId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!trimmedCardId) {
      toast.error('Card ID is required')
      return
    }

    const canonical = formatCardId(trimmedCardId)
    if (!canonical) {
      toast.error('Card ID must be a 4- or 7-byte hex UID')
      return
    }

    try {
      const created = await createCard({
        id: canonical,
        ...(designId ? { designId } : {}),
      })
      toast.success('Card created successfully')
      setOpen(false)
      setCardId('')
      setDesignId('')
      onSuccess?.()
      // Server assigns a fresh `randomBytes(16)` id on create; jump
      // straight to its detail page so the admin can continue pairing
      // without hunting for it in the list.
      if (created?.id) {
        router.push(`/admin/cards/${created.id}`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create card')
    }
  }

  function handleNfcClick() {
    if (!isWebNfcSupported()) {
      toast.error(
        'Web NFC isn’t available in this browser. Use Chrome on Android or enter the UID manually.',
      )
      return
    }
    setScanOpen(true)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 size-4" />
          Add Card
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Card</DialogTitle>
            <DialogDescription>
              Add a new BoltCard to the system.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="card-id">Card ID</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="card-id"
                  placeholder="04:AB:CD:EF:12:34:56"
                  value={cardId}
                  onChange={(e) => setCardId(e.target.value)}
                  onBlur={() => {
                    // Snap to canonical form on blur so the user sees the
                    // normalised UID rather than whatever formatting they
                    // pasted in (e.g. `04abcdef123456` → `04:AB:…`).
                    const canonical = formatCardId(cardId)
                    if (canonical) setCardId(canonical)
                  }}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={loading}
                  aria-invalid={cardIdInvalid || undefined}
                  className={cn(
                    cardIdInvalid &&
                      'border-destructive focus-visible:ring-destructive',
                  )}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleNfcClick}
                  disabled={loading}
                  aria-label="Scan NFC card"
                  title="Scan NFC card"
                >
                  <Nfc className="size-4" />
                </Button>
              </div>
              {cardIdInvalid ? (
                <p className="text-xs text-destructive">
                  Enter a 4- or 7-byte hex UID (e.g. 04:AB:CD:EF:12:34:56 or
                  04ABCDEF123456).
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The NFC card UID in hex format — colons optional.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="design-select">Design (optional)</Label>
              <Select value={designId} onValueChange={setDesignId} disabled={loading}>
                <SelectTrigger id="design-select">
                  <SelectValue placeholder="Select a design" />
                </SelectTrigger>
                <SelectContent>
                  {activeDesigns.map((design) => (
                    <SelectItem key={design.id} value={design.id}>
                      {design.description || design.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedDesign && (
                <DesignImage
                  src={selectedDesign.image}
                  alt={selectedDesign.description || 'Card design'}
                  className="mt-3"
                />
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !trimmedCardId || cardIdInvalid}
            >
              {loading ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Creating...
                </>
              ) : (
                'Create Card'
              )}
            </Button>
          </DialogFooter>
        </form>

        <NfcScanDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          onDetected={uid => {
            setCardId(uid)
            toast.success(`Card detected: ${uid}`)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
