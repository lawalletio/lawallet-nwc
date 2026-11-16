'use client'

import React, { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Lock, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useMutation } from '@/lib/client/hooks/use-api'

export interface AdminPoll {
  id: string
  slug: string
  title: string
  description?: string
  type: 'RANKING' | 'SINGLE_CHOICE'
  options: { id: string; label: string }[]
  allowCustom: boolean
  updatable: boolean
  status: 'DRAFT' | 'OPEN' | 'CLOSED'
  createdAt: string
  updatedAt: string
  responseCount: number
  lastResponseAt?: string | null
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

type OptionRow = { key: number; id: string; label: string; idTouched: boolean }

let rowKey = 0
const toRows = (options: AdminPoll['options']): OptionRow[] =>
  options.map(o => ({ key: rowKey++, ...o, idTouched: true }))
const blankRow = (): OptionRow => ({
  key: rowKey++,
  id: '',
  label: '',
  idTouched: false
})

export function PollFormDialog({
  open,
  onOpenChange,
  poll,
  onSaved
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this poll; create a new one when absent. */
  poll?: AdminPoll | null
  onSaved: () => void
}) {
  const { mutate, loading } = useMutation<unknown, AdminPoll>([
    '/api/admin/polls'
  ])
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [type, setType] = useState<AdminPoll['type']>('RANKING')
  const [rows, setRows] = useState<OptionRow[]>([])
  const [allowCustom, setAllowCustom] = useState(false)
  const [updatable, setUpdatable] = useState(true)

  // Type and option ids are frozen server-side once anyone answered.
  const frozen = !!poll && poll.responseCount > 0

  useEffect(() => {
    if (!open) return
    setTitle(poll?.title ?? '')
    setSlug(poll?.slug ?? '')
    setSlugTouched(!!poll)
    setDescription(poll?.description ?? '')
    setType(poll?.type ?? 'RANKING')
    setRows(poll ? toRows(poll.options) : [blankRow(), blankRow()])
    setAllowCustom(poll?.allowCustom ?? false)
    setUpdatable(poll?.updatable ?? true)
  }, [open, poll])

  function updateRow(key: number, patch: Partial<OptionRow>) {
    setRows(current =>
      current.map(row => {
        if (row.key !== key) return row
        const next = { ...row, ...patch }
        if (patch.label !== undefined && !row.idTouched) {
          next.id = slugify(patch.label)
        }
        return next
      })
    )
  }

  function move(index: number, delta: number) {
    setRows(current => {
      const next = [...current]
      const [row] = next.splice(index, 1)
      next.splice(index + delta, 0, row)
      return next
    })
  }

  async function save(status?: AdminPoll['status']) {
    const body = {
      title,
      slug,
      description: description.trim() || null,
      type,
      options: rows.map(({ id, label }) => ({ id, label })),
      allowCustom,
      updatable,
      ...(status ? { status } : {})
    }
    try {
      if (poll) {
        await mutate('patch', `/api/admin/polls/${poll.id}`, body)
        toast.success('Poll saved')
      } else {
        await mutate('post', '/api/admin/polls', body)
        toast.success(status === 'OPEN' ? 'Poll published' : 'Draft created')
      }
      onSaved()
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    }
  }

  const valid =
    title.trim() &&
    slug &&
    rows.length >= 2 &&
    rows.every(r => r.id && r.label.trim()) &&
    new Set(rows.map(r => r.id)).size === rows.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{poll ? 'Edit poll' : 'New poll'}</DialogTitle>
          <DialogDescription>
            Users answer from their wallet at{' '}
            <code className="text-xs">/api/polls/{slug || '…'}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="poll-title">Title</Label>
              <Input
                id="poll-title"
                value={title}
                maxLength={120}
                placeholder="USDT tech"
                onChange={e => {
                  setTitle(e.target.value)
                  if (!slugTouched) setSlug(slugify(e.target.value))
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="poll-slug">Slug</Label>
              <Input
                id="poll-slug"
                value={slug}
                className="font-mono text-sm"
                placeholder="usdt-tech"
                onChange={e => {
                  setSlugTouched(true)
                  setSlug(slugify(e.target.value))
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="poll-description">Description</Label>
            <Textarea
              id="poll-description"
              value={description}
              maxLength={500}
              rows={2}
              placeholder="Optional context shown above the options."
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="poll-type">Type</Label>
            <NativeSelect
              id="poll-type"
              value={type}
              disabled={frozen}
              onChange={e => setType(e.target.value as AdminPoll['type'])}
            >
              <option value="RANKING">Ranking — order every option</option>
              <option value="SINGLE_CHOICE">Single choice — pick one</option>
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Options</Label>
              {frozen && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="size-3" /> Ids locked — poll has responses
                </span>
              )}
            </div>
            <ol className="flex flex-col gap-2">
              {rows.map((row, index) => (
                <li
                  key={row.key}
                  className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2"
                >
                  <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Input
                      value={row.label}
                      maxLength={80}
                      placeholder="Label"
                      aria-label={`Option ${index + 1} label`}
                      className="h-8"
                      onChange={e =>
                        updateRow(row.key, { label: e.target.value })
                      }
                    />
                    <Input
                      value={row.id}
                      placeholder="option-id"
                      aria-label={`Option ${index + 1} id`}
                      disabled={frozen}
                      className="h-7 font-mono text-xs text-muted-foreground"
                      onChange={e =>
                        updateRow(row.key, {
                          id: slugify(e.target.value),
                          idTouched: true
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Move down"
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="Remove option"
                    disabled={frozen || rows.length <= 2}
                    onClick={() =>
                      setRows(current => current.filter(r => r.key !== row.key))
                    }
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={frozen || rows.length >= 20}
              onClick={() => setRows(current => [...current, blankRow()])}
            >
              <Plus className="size-4" /> Add option
            </Button>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <span className="flex flex-col">
                <Label htmlFor="poll-allow-custom">Allow a custom answer</Label>
                <span className="text-xs text-muted-foreground">
                  Users may add one free-text entry (up to 40 characters).
                </span>
              </span>
              <Switch
                id="poll-allow-custom"
                checked={allowCustom}
                onCheckedChange={setAllowCustom}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex flex-col">
                <Label htmlFor="poll-updatable">Updatable</Label>
                <span className="text-xs text-muted-foreground">
                  Off = one-time: the answer locks once submitted.
                </span>
              </span>
              <Switch
                id="poll-updatable"
                checked={updatable}
                onCheckedChange={setUpdatable}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {poll ? (
            <Button disabled={!valid || loading} onClick={() => save()}>
              Save
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={!valid || loading}
                onClick={() => save('DRAFT')}
              >
                Save draft
              </Button>
              <Button disabled={!valid || loading} onClick={() => save('OPEN')}>
                Publish
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
