'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  PlugZap,
  WandSparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/components/admin/auth-context'
import { useSettings } from '@/lib/client/hooks/use-settings'
import {
  INVALID_CLASSES,
  SaveStatusIcon,
  SettingTextInput,
  useDebouncedCallback,
  useSaveStatus,
  useSettingSaver,
} from '@/components/admin/settings/auto-save-controls'
import type { ListenerProbeResponse } from '@lawallet-nwc/shared'

/**
 * Setup guide on the documentation site (apps/docs) — same host convention as
 * the wallet Help Center link. Deep technical reference stays in the repo:
 * docs/services/NWC-LISTENER.md.
 */
const LISTENER_DOCS_URL = 'https://docs.lawallet.io/docs/deploy/listener-setup'

const SECRET_MIN_LENGTH = 32

type ProbeState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; uptimeSeconds: number; connections: number; relays: number }
  | { status: 'error'; error: string }

function isValidListenerUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

function generateSecretValue(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function NwcServicesTab() {
  const { data: settings, loading: settingsLoading } = useSettings()
  const saveSetting = useSettingSaver()
  const { apiClient } = useAuth()

  const [listenerEnabled, setListenerEnabled] = useState(false)
  const [listenerUrl, setListenerUrl] = useState('')
  const [listenerSecret, setListenerSecret] = useState('')
  const [secretVisible, setSecretVisible] = useState(false)
  const [enabledSaving, setEnabledSaving] = useState(false)
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' })
  const [deployGuideOpen, setDeployGuideOpen] = useState(false)

  // Hydrate exactly once — re-running on refetches would clobber live edits.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current || !settings) return
    hydratedRef.current = true
    setListenerEnabled(settings.listener_enabled === 'true')
    setListenerUrl(settings.listener_url ?? '')
    setListenerSecret(settings.listener_auth_secret ?? '')
  }, [settings])

  const urlFromEnv = settings?.listener_url_source === 'env'
  const secretFromEnv = settings?.listener_secret_source === 'env'
  const envProvisioned = urlFromEnv && secretFromEnv
  const urlInvalid =
    listenerUrl.trim() !== '' && !isValidListenerUrl(listenerUrl)
  const secretInvalid =
    listenerSecret !== '' && listenerSecret.length < SECRET_MIN_LENGTH
  const isConfigured =
    (listenerUrl.trim() !== '' || urlFromEnv) &&
    (listenerSecret !== '' || secretFromEnv)
  const needsConfig = listenerEnabled && !isConfigured
  const probeUrl = listenerUrl.trim() || settings?.listener_url_effective || ''

  // The three keys are interdependent (the API rejects enabling without a
  // resolvable url+secret), so they always persist together as one unit —
  // mirrors the paid-registration pattern in wallet-tab.tsx.
  const persistListener = useCallback(
    async (patch: { enabled?: boolean; url?: string; secret?: string }) => {
      const enabled = patch.enabled ?? listenerEnabled
      const url = (patch.url ?? listenerUrl).trim()
      const secret = patch.secret ?? listenerSecret
      const configured =
        (url !== '' || urlFromEnv) && (secret !== '' || secretFromEnv)
      await saveSetting({
        // Keep the DB consistent (disabled) until a full config exists —
        // the amber hint below the toggle explains it.
        listener_enabled: enabled && configured ? 'true' : 'false',
        listener_url: url,
        listener_auth_secret: secret,
      })
    },
    [
      saveSetting,
      listenerEnabled,
      listenerUrl,
      listenerSecret,
      urlFromEnv,
      secretFromEnv,
    ]
  )

  async function handleEnabledToggle(next: boolean) {
    const prev = listenerEnabled
    setListenerEnabled(next)
    // Turning on while unconfigured just reveals the hint — persistence
    // happens once the connection details exist.
    if (next && !isConfigured) return
    setEnabledSaving(true)
    try {
      await persistListener({ enabled: next })
    } catch (err) {
      setListenerEnabled(prev)
      toast.error(
        err instanceof Error ? err.message : 'Failed to update setting'
      )
    } finally {
      setEnabledSaving(false)
    }
  }

  const secretStatus = useSaveStatus()
  const debouncedSecretSave = useDebouncedCallback((value: string) => {
    if (value !== '' && value.length < SECRET_MIN_LENGTH) return
    void secretStatus.run(() => persistListener({ secret: value }))
  })

  function handleGenerateSecret() {
    const secret = generateSecretValue()
    setListenerSecret(secret)
    setSecretVisible(true)
    void secretStatus.run(() => persistListener({ secret }))
  }

  async function handleTestConnection() {
    setProbe({ status: 'testing' })
    try {
      const result = await apiClient.post<ListenerProbeResponse>(
        '/api/settings/listener-probe',
        {
          url: probeUrl,
          ...(listenerSecret ? { secret: listenerSecret } : {}),
        }
      )
      if (result.ok) {
        setProbe({
          status: 'ok',
          uptimeSeconds: result.uptimeSeconds,
          connections: result.connections,
          relays: result.relays,
        })
      } else {
        setProbe({ status: 'error', error: result.error })
      }
    } catch (err) {
      setProbe({
        status: 'error',
        error: err instanceof Error ? err.message : 'Connection test failed',
      })
    }
  }

  if (settingsLoading && !settings) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={24} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 px-4 pt-10 pb-8 w-full max-w-[1024px] mx-auto">
      {/* ── NWC Listener ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">NWC Listener</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Keeps persistent Nostr relay connections open so incoming payments
            arrive as webhooks and card withdraws respond faster. Optional —
            without it, NWC calls fall back to per-request relay connections.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Enable listener integration</p>
              <p className="text-sm text-muted-foreground">
                Route NWC traffic through the listener service and accept its
                payment webhooks.
              </p>
            </div>
            <span className="inline-flex items-center gap-2">
              {enabledSaving && (
                <Spinner size={16} className="text-muted-foreground" />
              )}
              <Switch
                checked={listenerEnabled}
                disabled={enabledSaving}
                onCheckedChange={handleEnabledToggle}
              />
            </span>
          </div>
          {needsConfig && (
            <p className="text-xs text-amber-500">
              Add a listener URL and shared secret below (or set LISTENER_URL /
              LISTENER_AUTH_SECRET on this host) to activate the integration.
            </p>
          )}

          {envProvisioned ? (
            <div className="rounded-md border bg-muted/25 p-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Provisioned via environment.
              </span>{' '}
              LISTENER_URL and LISTENER_AUTH_SECRET are set on this host —
              docker-compose, Umbrel and Start9 bundles do this automatically,
              so there is nothing to configure. The fields below override the
              environment if you ever need to point elsewhere.
            </div>
          ) : (
            <div className="rounded-md border bg-muted/25 p-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Running on Vercel or Netlify?
              </span>{' '}
              Serverless hosts can&apos;t run the listener in-process — deploy{' '}
              <code className="text-xs">apps/listener</code> separately on
              Railway, Render, Fly.io or any server with Docker, then paste its
              URL and shared secret here.{' '}
              <a
                href={LISTENER_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2"
              >
                Setup guide
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* ── Connection ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Connection</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Where the listener runs and the secret both services share.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <Label className="flex items-center gap-2">
              Listener URL
              {urlFromEnv && !listenerUrl && (
                <Badge variant="outline">from environment</Badge>
              )}
            </Label>
            <SettingTextInput
              value={listenerUrl}
              onValueChange={setListenerUrl}
              save={value => persistListener({ url: value })}
              invalid={urlInvalid}
              isInvalidValue={value =>
                value.trim() !== '' && !isValidListenerUrl(value)
              }
              placeholder={
                settings?.listener_url_effective || 'http://listener:4100'
              }
            />
            {urlInvalid ? (
              <p className="text-xs text-destructive">
                Enter a full http(s) URL, e.g. https://listener.example.com
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Base URL this instance uses to reach the listener service.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label className="flex items-center gap-2">
              Shared secret
              {secretFromEnv && !listenerSecret && (
                <Badge variant="outline">from environment</Badge>
              )}
            </Label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  type={secretVisible ? 'text' : 'password'}
                  value={listenerSecret}
                  placeholder={
                    secretFromEnv ? '(set via environment)' : 'Min 32 characters'
                  }
                  aria-invalid={secretInvalid || undefined}
                  className={secretInvalid ? `${INVALID_CLASSES} pr-9` : 'pr-9'}
                  onChange={e => {
                    setListenerSecret(e.target.value)
                    debouncedSecretSave(e.target.value)
                  }}
                />
                <button
                  type="button"
                  onClick={() => setSecretVisible(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={secretVisible ? 'Hide secret' : 'Show secret'}
                >
                  {secretVisible ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerateSecret}
              >
                <WandSparkles className="size-4" />
                Generate
              </Button>
              <SaveStatusIcon status={secretStatus.status} />
            </div>
            {secretInvalid ? (
              <p className="text-xs text-destructive">
                Must be at least {SECRET_MIN_LENGTH} characters.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Set the same value as LISTENER_AUTH_SECRET on the listener
                host — it signs webhooks and guards the listener API.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                !probeUrl ||
                urlInvalid ||
                secretInvalid ||
                probe.status === 'testing'
              }
              onClick={handleTestConnection}
            >
              {probe.status === 'testing' ? (
                <>
                  <Spinner size={16} />
                  Testing…
                </>
              ) : (
                <>
                  <PlugZap className="size-4" />
                  Test connection
                </>
              )}
            </Button>
          </div>
          {probe.status === 'ok' && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="size-4 text-emerald-500" />
                Listener reachable
              </p>
              <p className="mt-1 text-muted-foreground">
                Up {formatUptime(probe.uptimeSeconds)} · {probe.connections}{' '}
                NWC connection{probe.connections === 1 ? '' : 's'} ·{' '}
                {probe.relays} relay{probe.relays === 1 ? '' : 's'} ·{' '}
                <Link href="/admin/listener" className="underline underline-offset-2">
                  Open listener dashboard
                </Link>
              </p>
            </div>
          )}
          {probe.status === 'error' && (
            <p className="text-xs text-destructive">{probe.error}</p>
          )}
        </div>
      </div>

      <Separator />

      {/* ── Deploying the listener ───────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Deploying the listener</h3>
          <p className="text-sm text-muted-foreground mt-1">
            For hosts that can&apos;t run it alongside the web app.
          </p>
        </div>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeployGuideOpen(true)}
          >
            How to deploy the listener
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <DeployGuideDialog
        open={deployGuideOpen}
        onOpenChange={setDeployGuideOpen}
      />
    </div>
  )
}

/**
 * Step-by-step deployment walkthrough for hosts that can't run the listener
 * next to the web app (Vercel/Netlify). Kept as a modal so the checklist can
 * be followed side-by-side with the Connection form behind it.
 */
function DeployGuideDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const webOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://your-instance'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deploying the NWC Listener</DialogTitle>
          <DialogDescription>
            The listener keeps Nostr relay websockets open, which serverless
            hosts like Vercel and Netlify can&apos;t do — so it runs as its own
            small container next to your database. Docker Compose, Umbrel and
            Start9 deployments already include it; everyone else follows the
            three steps below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 text-sm">
          <section className="flex flex-col gap-2">
            <h4 className="font-semibold">1. Host the container</h4>
            <p className="text-muted-foreground">
              Deploy the <code className="text-xs">apps/listener</code> service
              from the LaWallet repository (Dockerfile:{' '}
              <code className="text-xs">apps/listener/Dockerfile</code>) on any
              always-on runtime:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Railway</span> —
                New Project → Deploy from GitHub repo → set{' '}
                <em>Dockerfile Path</em> to{' '}
                <code className="text-xs">apps/listener/Dockerfile</code> →
                generate a public domain.
              </li>
              <li>
                <span className="font-medium text-foreground">Render</span> —
                Web Service from the repo, environment <em>Docker</em>, same
                Dockerfile path.
              </li>
              <li>
                <span className="font-medium text-foreground">Fly.io</span> —{' '}
                <code className="text-xs">
                  fly launch --dockerfile apps/listener/Dockerfile
                </code>
                , expose port 4100.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  Any VPS with Docker
                </span>{' '}
                — build the image and run it behind your reverse proxy with
                TLS.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h4 className="font-semibold">2. Configure its environment</h4>
            <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
              <li>
                <code className="text-xs">DATABASE_URL</code> — the{' '}
                <span className="font-medium text-foreground">
                  same Postgres
                </span>{' '}
                this web app uses (hosted databases like Neon, Supabase or
                Railway Postgres work over the public internet).
              </li>
              <li>
                <code className="text-xs">LISTENER_AUTH_SECRET</code> — the
                shared secret from the Connection section (use{' '}
                <span className="font-medium text-foreground">Generate</span>,
                then copy the value over — both sides must match).
              </li>
              <li>
                <code className="text-xs">WEB_ORIGIN</code> — this
                instance&apos;s public URL (
                <code className="text-xs">{webOrigin}</code>) — payment
                webhooks are POSTed back here.
              </li>
              <li>
                <code className="text-xs">LISTENER_PORT</code> — the port the
                listener binds (default 4100).
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h4 className="font-semibold">3. Connect it here</h4>
            <p className="text-muted-foreground">
              Paste the service&apos;s public URL into{' '}
              <span className="font-medium text-foreground">Listener URL</span>
              , make sure the shared secret matches, click{' '}
              <span className="font-medium text-foreground">
                Test connection
              </span>{' '}
              and flip{' '}
              <span className="font-medium text-foreground">
                Enable listener integration
              </span>
              . The NWC Listener dashboard then appears in the sidebar.
            </p>
          </section>
        </div>

        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={LISTENER_DOCS_URL} target="_blank" rel="noreferrer">
              Open the full guide
              <ExternalLink className="size-4" />
            </a>
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
