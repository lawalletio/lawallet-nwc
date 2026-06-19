'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Spinner } from '@/components/ui/spinner'

/**
 * Dev-only "Remove all cards" button. Wipes every card (+ NTAG424 keys) via the
 * dev-gated `DELETE /api/dev/cards` so the card flow can be re-tested.
 *
 * Render it behind `process.env.NODE_ENV === 'development'` (Next inlines that
 * to `false` in production builds, so the button is tree-shaken out), and the
 * endpoint itself 404s outside development — double-gated.
 */
export function DevRemoveAllCards({ onRemoved }: { onRemoved?: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function removeAll() {
    setLoading(true)
    try {
      const res = await fetch('/api/dev/cards', { method: 'DELETE' })
      if (!res.ok) throw new Error(`Failed to remove cards (${res.status})`)
      const data = await res.json()
      toast.success(`Removed ${data.deleted?.cards ?? 0} card(s)`)
      onRemoved?.()
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove cards')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
          Remove all cards
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove all cards?</AlertDialogTitle>
          <AlertDialogDescription>
            Dev-only. Permanently deletes <strong>every</strong> card and its
            NTAG424 keys (activation tokens cascade). This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          {/* A plain button (not AlertDialogAction) so the dialog stays open
              while the request is in flight. */}
          <Button variant="destructive" onClick={removeAll} disabled={loading}>
            {loading ? <Spinner size={16} /> : <Trash2 className="size-4" />}
            Remove all
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
