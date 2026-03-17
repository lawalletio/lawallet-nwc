'use client'

import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
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
import { useDesigns } from '@/lib/client/hooks/use-designs'
import { useCardMutations } from '@/lib/client/hooks/use-cards'

interface CreateCardDialogProps {
  onSuccess?: () => void
}

export function CreateCardDialog({ onSuccess }: CreateCardDialogProps) {
  const [open, setOpen] = useState(false)
  const [cardId, setCardId] = useState('')
  const [designId, setDesignId] = useState<string>('')
  const { data: designs } = useDesigns()
  const { createCard, loading } = useCardMutations()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!cardId.trim()) {
      toast.error('Card ID is required')
      return
    }

    try {
      await createCard({
        id: cardId.trim(),
        ...(designId ? { designId } : {}),
      })
      toast.success('Card created successfully')
      setOpen(false)
      setCardId('')
      setDesignId('')
      onSuccess?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create card')
    }
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
              <Input
                id="card-id"
                placeholder="04:AB:CD:EF:12:34:56"
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                The NFC card UID in hex format
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="design-select">Design (optional)</Label>
              <Select value={designId} onValueChange={setDesignId} disabled={loading}>
                <SelectTrigger id="design-select">
                  <SelectValue placeholder="Select a design" />
                </SelectTrigger>
                <SelectContent>
                  {designs?.map((design) => (
                    <SelectItem key={design.id} value={design.id}>
                      {design.description || design.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Button type="submit" disabled={loading || !cardId.trim()}>
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
      </DialogContent>
    </Dialog>
  )
}
