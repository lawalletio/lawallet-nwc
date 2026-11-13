'use client'

import React, { useState } from 'react'
import { ArrowLeftRight, ExternalLink, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { useMutation } from '@/lib/client/hooks/use-api'
import type { IntegrationMeta } from '@/lib/integrations/catalog'
import { cn } from '@/lib/utils'

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

export function IntegrationCard({ integration: it, onSaved }: Props) {
  // Secrets start blank (write-only); plain fields start from the server.
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      it.fields.map(f => [f.key, f.secret ? '' : (it.values[f.key] ?? '')])
    )
  )
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null)
  const save = useMutation<
    { enabled?: boolean; config?: Record<string, string> },
    { ok: boolean }
  >(['/api/integrations', '/api/settings'])
  const runTest = useMutation<void, { ok: boolean; detail: string }>()

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

  async function saveConfig() {
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

  const Icon = it.kind === 'swap' ? ArrowLeftRight : Search

  return (
    <div
      className={cn(
        'rounded-xl border p-5 flex flex-col gap-4 transition-colors',
        it.enabled && it.configured && 'border-primary/60 bg-primary/5'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-muted p-2">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{it.name}</h3>
            <Badge variant="outline">
              {it.kind === 'swap' ? 'Cash-out' : 'Lookup'}
            </Badge>
            <Badge variant={it.configured ? 'default' : 'secondary'}>
              {it.configured ? 'Configured' : 'Not configured'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {it.description}{' '}
            <a
              href={it.website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 underline underline-offset-2"
            >
              Website <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
        <Switch
          aria-label={`Enable ${it.name}`}
          checked={it.enabled}
          disabled={save.loading || (!it.configured && !it.enabled)}
          onCheckedChange={toggle}
        />
      </div>

      <div className="flex flex-col gap-3">
        {it.fields.map(f => {
          const secretSet = f.secret && it.secretsConfigured[f.key]
          const id = `${it.id}-${f.key}`
          return (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={id}>{f.label}</Label>
              <Input
                id={id}
                type={f.secret ? 'password' : 'text'}
                autoComplete={f.secret ? 'new-password' : 'off'}
                placeholder={
                  secretSet ? '•••••••• (configured)' : f.placeholder
                }
                value={draft[f.key] ?? ''}
                onChange={e =>
                  setDraft(d => ({ ...d, [f.key]: e.target.value }))
                }
              />
              {f.help && (
                <p className="text-xs text-muted-foreground break-words">
                  {f.help}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || save.loading}
          onClick={saveConfig}
        >
          {save.loading && <Spinner size={12} />} Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!it.configured || runTest.loading || dirty}
          onClick={check}
        >
          {runTest.loading && <Spinner size={12} />} Test connection
        </Button>
        {test && (
          <span
            role="status"
            className={cn(
              'text-xs',
              test.ok
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-destructive'
            )}
          >
            {test.detail}
          </span>
        )}
      </div>
    </div>
  )
}
