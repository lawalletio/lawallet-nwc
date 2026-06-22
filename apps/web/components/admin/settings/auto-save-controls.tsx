'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'
import { useMutation, invalidateApiPath } from '@/lib/client/hooks/use-api'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'
import { cn } from '@/lib/utils'

/**
 * Default debounce for text inputs: wait this long after the last keystroke
 * before persisting. Short enough to feel responsive, long enough to avoid
 * firing mid-word.
 */
export const SETTING_DEBOUNCE_MS = 400

/**
 * Error-state classes shared by every settings field. tailwind-merge lets the
 * `border-destructive` win over the component's default `border-input` /
 * `border-border`.
 */
export const INVALID_CLASSES =
  'border-destructive focus-visible:ring-destructive focus-within:ring-destructive'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Persist a partial settings patch. Each settings element saves itself through
 * this — the API route upserts only the keys it receives, so per-field saves
 * never clobber other settings. After a successful save we invalidate the
 * `/api/settings` cache so other consumers (sidebar/topbar branding, etc.)
 * pick up the change even if the SSE bus isn't connected.
 */
export function useSettingSaver() {
  const { mutate } = useMutation<Record<string, string>>()
  return useCallback(
    async (patch: Record<string, string>) => {
      await mutate('post', '/api/settings', patch)
      invalidateApiPath('/api/settings')
      trackEvent(AnalyticsEvent.SETTINGS_UPDATED, {
        keys: Object.keys(patch).join(','),
      })
    },
    [mutate]
  )
}

/** Trailing spinner / check shown while a field is saving. */
export function SaveStatusIcon({
  status,
  className,
}: {
  status: SaveStatus
  className?: string
}) {
  if (status === 'saving') {
    return <Spinner size={16} className={cn('text-muted-foreground', className)} />
  }
  if (status === 'saved') {
    return <Check className={cn('size-4 text-emerald-500', className)} />
  }
  return null
}

/**
 * Debounced save engine shared by the text field components. The owning
 * component holds the controlled `value`; this hook only schedules the
 * persistence. It never fires on external value changes (e.g. settings
 * hydration) — only the field's own `handleChange` schedules a save.
 */
function useDebouncedSave(
  value: string,
  {
    save,
    debounceMs = SETTING_DEBOUNCE_MS,
    isInvalid,
  }: {
    save: (value: string) => Promise<void>
    debounceMs?: number
    isInvalid?: (value: string) => boolean
  }
) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  // Seed with the initial committed value so a blur with no edits is a no-op.
  const lastSavedRef = useRef<string>(value)
  const pendingRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep callbacks fresh without re-creating handlers on every render.
  const saveRef = useRef(save)
  const invalidRef = useRef(isInvalid)
  useEffect(() => {
    saveRef.current = save
    invalidRef.current = isInvalid
  })

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const runSave = useCallback(async (next: string) => {
    pendingRef.current = null
    if (invalidRef.current?.(next)) return
    if (lastSavedRef.current === next) return
    setStatus('saving')
    try {
      await saveRef.current(next)
      lastSavedRef.current = next
      setStatus('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setStatus('idle'), 1500)
    } catch (err) {
      setStatus('error')
      toast.error(err instanceof Error ? err.message : 'Failed to save setting')
    }
  }, [])

  const handleChange = useCallback(
    (next: string) => {
      pendingRef.current = next
      clearTimer()
      // Drop any lingering "saved" check while the user is editing again.
      setStatus(s => (s === 'saved' ? 'idle' : s))
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void runSave(next)
      }, debounceMs)
    },
    [debounceMs, runSave]
  )

  // Flush a pending edit immediately (used on blur) so leaving a field never
  // strands an unsaved value behind the debounce window.
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimer()
      if (pendingRef.current !== null) void runSave(pendingRef.current)
    }
  }, [runSave])

  useEffect(
    () => () => {
      clearTimer()
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    },
    []
  )

  return { status, handleChange, flush }
}

interface SettingTextInputProps
  extends Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value'> {
  value: string
  /** Update the owning component's local state (keeps typing responsive). */
  onValueChange: (value: string) => void
  /** Persist the value. Called debounced, and again on blur if pending. */
  save: (value: string) => Promise<void>
  /** Apply the error border. */
  invalid?: boolean
  /** When this returns true the debounced save is skipped (value left local). */
  isInvalidValue?: (value: string) => boolean
  debounceMs?: number
}

/** A plain text input that auto-saves on a debounce with a status indicator. */
export function SettingTextInput({
  value,
  onValueChange,
  save,
  invalid,
  isInvalidValue,
  debounceMs,
  className,
  onBlur,
  ...inputProps
}: SettingTextInputProps) {
  const { status, handleChange, flush } = useDebouncedSave(value, {
    save,
    debounceMs,
    isInvalid: isInvalidValue,
  })
  return (
    <div className="relative">
      <Input
        {...inputProps}
        value={value}
        aria-invalid={invalid || undefined}
        className={cn(invalid && INVALID_CLASSES, status !== 'idle' && 'pr-9', className)}
        onChange={e => {
          onValueChange(e.target.value)
          handleChange(e.target.value)
        }}
        onBlur={e => {
          flush()
          onBlur?.(e)
        }}
      />
      {status !== 'idle' && (
        <SaveStatusIcon
          status={status}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
        />
      )}
    </div>
  )
}

interface SettingInputGroupProps
  extends Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value' | 'prefix'> {
  value: string
  onValueChange: (value: string) => void
  save: (value: string) => Promise<void>
  invalid?: boolean
  isInvalidValue?: (value: string) => boolean
  debounceMs?: number
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  groupClassName?: string
}

/**
 * An InputGroup (with optional prefix/suffix label) that auto-saves on a
 * debounce. The status indicator sits between the input and the suffix.
 */
export function SettingInputGroup({
  value,
  onValueChange,
  save,
  invalid,
  isInvalidValue,
  debounceMs,
  prefix,
  suffix,
  groupClassName,
  className,
  onBlur,
  ...inputProps
}: SettingInputGroupProps) {
  const { status, handleChange, flush } = useDebouncedSave(value, {
    save,
    debounceMs,
    isInvalid: isInvalidValue,
  })
  return (
    <InputGroup className={cn(invalid && INVALID_CLASSES, groupClassName)}>
      {prefix != null && <InputGroupText>{prefix}</InputGroupText>}
      <Input
        {...inputProps}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={e => {
          onValueChange(e.target.value)
          handleChange(e.target.value)
        }}
        onBlur={e => {
          flush()
          onBlur?.(e)
        }}
        className={cn(
          'border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
          className
        )}
      />
      {status !== 'idle' && (
        <span className="flex items-center self-stretch pl-1 pr-3">
          <SaveStatusIcon status={status} />
        </span>
      )}
      {suffix != null && <InputGroupText position="suffix">{suffix}</InputGroupText>}
    </InputGroup>
  )
}

interface SettingSwitchProps
  extends Omit<
    React.ComponentProps<typeof Switch>,
    'checked' | 'onCheckedChange' | 'disabled'
  > {
  checked: boolean
  /** Update the owning component's local state (optimistic). */
  onCheckedChange: (checked: boolean) => void
  /** Persist the toggle. Reverts the optimistic flip if it rejects. */
  save: (checked: boolean) => Promise<void>
  disabled?: boolean
}

/**
 * A switch that persists immediately on toggle. Disabled (and showing a
 * spinner) while the save is in flight; reverts on error.
 */
export function SettingSwitch({
  checked,
  onCheckedChange,
  save,
  disabled,
  ...switchProps
}: SettingSwitchProps) {
  const [saving, setSaving] = useState(false)

  async function handle(next: boolean) {
    const prev = checked
    onCheckedChange(next)
    setSaving(true)
    try {
      await save(next)
    } catch (err) {
      onCheckedChange(prev)
      toast.error(err instanceof Error ? err.message : 'Failed to update setting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {saving && <Spinner size={16} className="text-muted-foreground" />}
      <Switch
        {...switchProps}
        checked={checked}
        disabled={disabled || saving}
        onCheckedChange={handle}
      />
    </span>
  )
}

/**
 * Track a save's status (saving → saved → idle, or error) for sections that
 * aren't a single field component — e.g. array-valued settings like relays /
 * blossom servers. `run` wraps the async save and surfaces failures as a toast.
 */
export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    },
    []
  )

  const run = useCallback(async (fn: () => Promise<void>) => {
    setStatus('saving')
    try {
      await fn()
      setStatus('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setStatus('idle'), 1500)
    } catch (err) {
      setStatus('error')
      toast.error(err instanceof Error ? err.message : 'Failed to save setting')
    }
  }, [])

  return { status, run }
}

/**
 * Debounce an arbitrary callback (used for array-valued settings like relays /
 * blossom servers, where a single field maps to a serialized list rather than
 * one key). Returns a stable debounced function plus a `cancel` for cleanup.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay = SETTING_DEBOUNCE_MS
) {
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const debounced = useCallback(
    (...args: A) => {
      cancel()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        fnRef.current(...args)
      }, delay)
    },
    [cancel, delay]
  )

  useEffect(() => cancel, [cancel])

  return debounced
}
