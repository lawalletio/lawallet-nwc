'use client'

import React, { useState } from 'react'
import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { useMutation } from '@/lib/client/hooks/use-api'
import type { IntegrationMeta } from '@/lib/integrations/catalog'
import { cn } from '@/lib/utils'
import { IntegrationIcon } from './brand-icons'

export interface IntegrationState extends IntegrationMeta {
  enabled: boolean
  configured: boolean
  values: Record<string, string>
  secretsConfigured: Record<string, boolean>
}

interface Props {
  integration: IntegrationState
  onSaved: () => void
}

export const KIND_LABEL: Record<IntegrationMeta['kind'], string> = {
  swap: 'Cash-out',
  lookup: 'Lookup',
  dns: 'DNS'
}

type TestResult = { ok: boolean; detail: string }

type Status = 'not_set_up' | 'configured' | 'enabled' | 'incomplete' | 'error'

const STATUS: Record<Status, { label: string; className: string }> = {
  not_set_up: {
    label: 'Not set up',
    className: 'border-border bg-muted/50 text-muted-foreground'
  },
  configured: {
    label: 'Configured',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
  },
  enabled: {
    label: 'Enabled',
    className:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  },
  // Enabled but a required field went missing: users can't use it.
  incomplete: {
    label: 'Incomplete',
    className:
      'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  },
  // The last connection test in this session failed.
  error: {
    label: 'Connection failed',
    className: 'border-destructive/40 bg-destructive/10 text-destructive'
  }
}

export function integrationStatus(
  it: Pick<IntegrationState, 'enabled' | 'configured'>,
  test: TestResult | null = null
): Status {
  if (test && !test.ok) return 'error'
  if (it.enabled && !it.configured) return 'incomplete'
  if (!it.configured) return 'not_set_up'
  return it.enabled ? 'enabled' : 'configured'
}

function StatusBadge({ status }: { status: Status }) {
  const { label, className } = STATUS[status]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        className
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

export function IntegrationCard({ integration: it, onSaved }: Props) {
  const [open, setOpen] = useState(false)
  // Lives on the card so a failed test still shows after the dialog closes.
  const [test, setTest] = useState<TestResult | null>(null)
  const status = integrationStatus(it, test)
  const titleId = `integration-${it.id}-title`

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        'group flex flex-col gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-foreground/20',
        status === 'enabled' && 'border-emerald-500/30'
      )}
    >
      <div className="flex items-start gap-3">
        <IntegrationIcon id={it.id} />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm leading-snug font-semibold">
            {it.name}
          </h3>
          <p className="text-xs text-muted-foreground">{KIND_LABEL[it.kind]}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">
        {it.description}
      </p>

      <div className="flex items-center justify-between gap-2">
        <a
          href={it.website}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          Website <ExternalLink aria-hidden className="size-3" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <Button
          size="sm"
          variant={it.configured ? 'outline' : 'default'}
          onClick={() => setOpen(true)}
          aria-label={`${it.configured ? 'Configure' : 'Set up'} ${it.name}`}
        >
          {it.configured ? 'Configure' : 'Set up'}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          {/* Mounted only while open: drafts start fresh from the server each time. */}
          {open && (
            <IntegrationConfig
              integration={it}
              status={status}
              test={test}
              setTest={setTest}
              onSaved={onSaved}
            />
          )}
        </DialogContent>
      </Dialog>
    </article>
  )
}

function IntegrationConfig({
  integration: it,
  status,
  test,
  setTest,
  onSaved
}: Props & {
  status: Status
  test: TestResult | null
  setTest: (t: TestResult | null) => void
}) {
  // Secrets start blank (write-only); plain fields start from the server.
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      it.fields.map(f => [f.key, f.secret ? '' : (it.values[f.key] ?? '')])
    )
  )
  const save = useMutation<
    { enabled?: boolean; config?: Record<string, string> },
    { ok: boolean }
  >(['/api/integrations', '/api/settings'])
  const runTest = useMutation<void, TestResult>()

  const dirty = it.fields.some(f =>
    f.secret ? draft[f.key] !== '' : draft[f.key] !== (it.values[f.key] ?? '')
  )

  async function put(body: {
    enabled?: boolean
    config?: Record<string, string>
  }) {
    try {
      await save.mutate('put', `/api/integrations/${it.id}`, body)
      onSaved()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
      return false
    }
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty || save.loading) return
    if (await put({ config: draft })) {
      setDraft(d =>
        Object.fromEntries(
          it.fields.map(f => [f.key, f.secret ? '' : (d[f.key] ?? '')])
        )
      )
      setTest(null)
      toast.success(`${it.name} saved`)
    }
  }

  async function toggle(enabled: boolean) {
    if (await put({ enabled })) {
      toast.success(`${it.name} ${enabled ? 'enabled' : 'disabled'}`)
    }
  }

  async function check() {
    try {
      setTest(await runTest.mutate('post', `/api/integrations/${it.id}/test`))
    } catch (err) {
      setTest({
        ok: false,
        detail: err instanceof Error ? err.message : 'Test failed'
      })
    }
  }

  const switchId = `${it.id}-enabled`
  const canToggle = it.configured || it.enabled

  return (
    <form onSubmit={saveConfig} className="flex flex-col gap-5">
      <DialogHeader className="flex-row items-start gap-3 space-y-0 pr-6 text-left">
        <IntegrationIcon id={it.id} className="size-12 p-2" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{it.name}</DialogTitle>
            <StatusBadge status={status} />
          </div>
          <DialogDescription>{it.description}</DialogDescription>
          <a
            href={it.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-sm text-xs underline underline-offset-4 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {new URL(it.website).hostname.replace(/^www\./, '')}
            <ExternalLink aria-hidden className="size-3" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </DialogHeader>

      <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-3">
        <div className="space-y-0.5">
          <Label htmlFor={switchId}>Enabled</Label>
          <p id={`${switchId}-hint`} className="text-xs text-muted-foreground">
            {canToggle
              ? 'Members can use it while it is on.'
              : 'Save the required fields to turn it on.'}
          </p>
        </div>
        <Switch
          id={switchId}
          aria-describedby={`${switchId}-hint`}
          checked={it.enabled}
          disabled={save.loading || !canToggle}
          onCheckedChange={toggle}
        />
      </div>

      <div className="flex flex-col gap-4">
        {it.fields.map(f => {
          const secretSet = f.secret && it.secretsConfigured[f.key]
          const id = `${it.id}-${f.key}`
          const helpId = `${id}-help`
          return (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={id}>
                {f.label}
                {f.required ? (
                  <span aria-hidden className="text-destructive">
                    {' '}
                    *
                  </span>
                ) : (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    (optional)
                  </span>
                )}
              </Label>
              <Input
                id={id}
                type={f.secret ? 'password' : 'text'}
                autoComplete={f.secret ? 'new-password' : 'off'}
                spellCheck={false}
                aria-required={f.required || undefined}
                aria-describedby={f.help ? helpId : undefined}
                placeholder={
                  secretSet
                    ? '•••••••• (saved — type to replace)'
                    : f.placeholder
                }
                value={draft[f.key] ?? ''}
                onChange={e =>
                  setDraft(d => ({ ...d, [f.key]: e.target.value }))
                }
              />
              {f.help && (
                <p
                  id={helpId}
                  className="text-xs break-words text-muted-foreground"
                >
                  {f.help}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {test && (
        <div
          role="status"
          className={cn(
            'flex items-start gap-2 rounded-lg border p-3 text-sm',
            test.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          )}
        >
          {test.ok ? (
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          ) : (
            <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="break-words">{test.detail}</span>
        </div>
      )}

      <DialogFooter className="gap-2 sm:gap-0">
        <Button
          type="button"
          variant="outline"
          disabled={!it.configured || runTest.loading || dirty}
          title={dirty ? 'Save your changes first' : undefined}
          onClick={check}
        >
          {runTest.loading && <Spinner size={12} />} Test connection
        </Button>
        <Button type="submit" disabled={!dirty || save.loading}>
          {save.loading && <Spinner size={12} />} Save
        </Button>
      </DialogFooter>
    </form>
  )
}
