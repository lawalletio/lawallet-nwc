'use client'

import { useId, useState, type FormEvent } from 'react'
import { Tag, Check, Plus } from 'lucide-react'
import { useAuth } from '@/components/admin/auth-context'
import { useApi, invalidateApiPath } from '@/lib/client/hooks/use-api'
import { TRANSACTION_LABEL_MAX_LENGTH } from '@lawallet-nwc/shared'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export function TransactionTagPicker({
  paymentHash,
  tag,
  onSaved
}: {
  paymentHash: string
  tag?: string | null
  onSaved: (tag: string | null) => void
}) {
  const { apiClient } = useAuth()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const titleId = useId()
  const inputId = useId()
  const errorId = useId()
  const path = `/api/wallet/transactions/${paymentHash}/label`
  const tags = useApi<{ tags: string[] }>(
    open ? '/api/wallet/transaction-tags' : null
  )
  const current = useApi<{ label: string | null }>(open ? path : null)
  const unavailable =
    tags.loading ||
    current.loading ||
    !tags.data ||
    !current.data ||
    Boolean(tags.error || current.error)

  async function save(label: string) {
    if (saving || unavailable) return
    setSaving(true)
    setSaveError('')
    try {
      const saved = await apiClient.put<{ label: string | null }>(path, {
        label
      })
      invalidateApiPath(path)
      invalidateApiPath('/api/wallet/transaction-tags')
      onSaved(saved.label)
      setOpen(false)
      setCreating(false)
      setDraft('')
    } catch {
      setSaveError('Could not save tag. Try again.')
    } finally {
      setSaving(false)
    }
  }

  function create(event: FormEvent) {
    event.preventDefault()
    if (draft.trim()) void save(draft.trim())
  }

  return (
    <Popover
      open={open}
      onOpenChange={value => {
        if (saving) return
        setOpen(value)
        setCreating(false)
        setDraft('')
        setSaveError('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={tag ? 'sm' : 'icon'}
          aria-label={tag ? `Choose tag: ${tag}` : 'Choose tag'}
          title={tag || 'Choose tag'}
          className={
            tag
              ? 'mx-1 h-auto min-h-11 min-w-0 max-w-28 shrink px-1.5'
              : 'group relative size-11 shrink-0'
          }
        >
          {tag ? (
            <span className="truncate rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
              {tag}
            </span>
          ) : (
            <>
              <Tag aria-hidden="true" className="size-4" />
              <Plus
                aria-hidden="true"
                className="absolute right-1 top-1 size-3 scale-75 opacity-0 transition-[opacity,transform] group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
              />
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-labelledby={titleId}
        className="flex w-52 max-w-[calc(100vw-2rem)] flex-col gap-1.5 p-2"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 id={titleId} className="text-sm font-medium">
            Tags
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Add new tag"
            className="size-7"
            disabled={unavailable || saving}
            onClick={() => setCreating(value => !value)}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        {tags.error || current.error ? (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-sm text-destructive">
              Could not load tags.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void Promise.all([tags.refetch(), current.refetch()])
              }
            >
              Retry tags
            </Button>
          </div>
        ) : tags.loading || current.loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading tags…
          </p>
        ) : (
          <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {tags.data?.tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved tags yet. Use + to add one.
              </p>
            ) : null}
            {tags.data?.tags.map(tag => (
              <Button
                key={tag}
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 justify-between px-2"
                aria-pressed={current.data?.label === tag}
                disabled={saving || unavailable}
                onClick={() => void save(tag)}
              >
                <span className="truncate">{tag}</span>
                {current.data?.label === tag ? (
                  <Check aria-hidden="true" />
                ) : null}
              </Button>
            ))}
            {current.data?.label ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                disabled={saving || unavailable}
                onClick={() => void save('')}
              >
                Remove tag
              </Button>
            ) : null}
          </div>
        )}
        {creating ? (
          <form onSubmit={create}>
            <Field>
              <Field data-invalid={Boolean(saveError)}>
                <FieldLabel htmlFor={inputId}>New tag</FieldLabel>
                <Input
                  id={inputId}
                  className="h-8"
                  autoFocus
                  value={draft}
                  maxLength={TRANSACTION_LABEL_MAX_LENGTH}
                  disabled={saving || unavailable}
                  aria-invalid={Boolean(saveError)}
                  aria-describedby={errorId}
                  onChange={event => {
                    setDraft(event.target.value)
                    setSaveError('')
                  }}
                />
              </Field>
              <Button
                type="submit"
                size="sm"
                className="h-8"
                disabled={saving || unavailable || !draft.trim()}
              >
                {saving ? 'Saving…' : 'Create and apply'}
              </Button>
            </Field>
          </form>
        ) : null}
        <FieldError id={errorId} role="alert">
          {saveError}
        </FieldError>
      </PopoverContent>
    </Popover>
  )
}
