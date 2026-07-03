'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Radio, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useUserMutations } from '@/lib/client/hooks/use-users'
import { cn } from '@/lib/utils'

/**
 * Popular Nostr relays offered as one-tap suggestions. lacrypta.ar leads
 * intentionally — it's the community's home relay.
 */
const POPULAR_RELAYS = [
  'wss://lacrypta.ar',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://relay.snort.social',
]

/** Soft guidance threshold — not a hard cap (the server allows up to 20). */
const SUGGESTED_MAX = 7

function isValidRelay(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value.trim())
    return (protocol === 'wss:' || protocol === 'ws:') && hostname.length > 0
  } catch {
    return false
  }
}

const normalize = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '')

interface RelayEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  relays: string[]
  onSaved: (relays: string[]) => void
}

export function RelayEditorDialog({
  open,
  onOpenChange,
  userId,
  relays: initialRelays,
  onSaved,
}: RelayEditorDialogProps) {
  const { updateUserRelays, loading } = useUserMutations()
  const [rows, setRows] = useState<string[]>([])

  // Seed the editor from the current relays each time it opens so a cancelled
  // edit never leaks into the next session.
  useEffect(() => {
    if (open) setRows(initialRelays.length > 0 ? [...initialRelays] : [''])
  }, [open, initialRelays])

  const filled = useMemo(() => rows.map(r => r.trim()).filter(Boolean), [rows])
  const invalid = rows.map(r => r.trim().length > 0 && !isValidRelay(r))
  const hasInvalid = invalid.some(Boolean)
  const overSuggested = filled.length >= SUGGESTED_MAX

  const present = useMemo(() => new Set(filled.map(normalize)), [filled])
  const suggestions = POPULAR_RELAYS.filter(r => !present.has(normalize(r)))

  function setRow(index: number, value: string) {
    setRows(prev => prev.map((r, i) => (i === index ? value : r)))
  }
  function addRow() {
    // Don't stack empty rows — reuse a trailing blank if one is already there.
    setRows(prev => (prev[prev.length - 1]?.trim() === '' ? prev : [...prev, '']))
  }
  function removeRow(index: number) {
    setRows(prev => {
      const next = prev.filter((_, i) => i !== index)
      return next.length > 0 ? next : ['']
    })
  }
  function addSuggestion(url: string) {
    setRows(prev => {
      const kept = prev.filter(r => r.trim())
      return [...kept, url]
    })
  }

  async function handleSave() {
    if (hasInvalid) return
    // Dedup (case-insensitive, trailing-slash-insensitive) before sending.
    const seen = new Set<string>()
    const deduped: string[] = []
    for (const url of filled) {
      const key = normalize(url)
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(url)
    }
    try {
      await updateUserRelays(userId, deduped)
      onSaved(deduped)
      onOpenChange(false)
      toast.success(
        deduped.length === 0
          ? 'Relays cleared'
          : `Saved ${deduped.length} relay${deduped.length === 1 ? '' : 's'}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save relays')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="size-4" />
            Nostr relays
          </DialogTitle>
          <DialogDescription>
            Where your Nostr profile and events are published. Add the relays you
            want your identity discoverable on.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {rows.map((relay, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={relay}
                onChange={e => setRow(index, e.target.value)}
                placeholder="wss://relay.example.com"
                spellCheck={false}
                autoCapitalize="none"
                className={cn(
                  'flex-1 font-mono text-sm',
                  invalid[index] &&
                    'border-destructive focus-visible:ring-destructive',
                )}
                aria-invalid={invalid[index] || undefined}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => removeRow(index)}
                aria-label="Remove relay"
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 self-start"
            onClick={addRow}
          >
            <Plus className="size-4" />
            Add relay
          </Button>
        </div>

        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Popular relays
            </span>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map(url => (
                <button
                  key={url}
                  type="button"
                  onClick={() => addSuggestion(url)}
                  className="inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-1 font-mono text-xs text-foreground transition hover:bg-accent hover:text-accent-foreground"
                >
                  <Plus className="size-3" />
                  {url.replace(/^wss:\/\//, '')}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Soft guidance: fewer than 7 relays. Turns into a warning at/above it. */}
        <p
          className={cn(
            'flex items-center gap-1.5 text-xs',
            overSuggested ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground',
          )}
        >
          {overSuggested && <TriangleAlert className="size-3.5 shrink-0" />}
          {overSuggested
            ? `You have ${filled.length} relays. We suggest keeping fewer than ${SUGGESTED_MAX} — more relays slow down publishing without much benefit.`
            : `Tip: keep it under ${SUGGESTED_MAX} relays for faster publishing.`}
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={hasInvalid || loading}>
            {loading ? 'Saving…' : 'Save relays'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
