'use client'

import React, { useState } from 'react'
import {
  BellRing,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  Eye,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Send,
  Webhook
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  CursorPagination,
  useCursorPagination
} from '@/components/wallet/shared/cursor-pagination'
import { ForwardingStatusBadge } from '@/components/wallet/shared/forwarding-status'
import { errorMessage } from '@/lib/error-message'
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
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  useRemoteWalletNotificationDeliveries,
  useRemoteWalletNotificationMutations,
  useRemoteWalletNotifications,
  type CreateRemoteWalletNotificationInput,
  type RemoteWalletNotificationAction,
  type RemoteWalletNotificationData,
  type RemoteWalletNotificationDeliveryData
} from '@/lib/client/hooks/use-remote-wallet-notifications'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 8

export function RemoteWalletNotificationsPanel({
  walletId
}: {
  walletId: string
}) {
  const notifications = useRemoteWalletNotifications(walletId)
  const pagination = useCursorPagination()
  const deliveries = useRemoteWalletNotificationDeliveries(walletId, {
    cursor: pagination.cursor,
    limit: PAGE_SIZE
  })
  const mutations = useRemoteWalletNotificationMutations(walletId)
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] =
    useState<RemoteWalletNotificationDeliveryData | null>(null)

  async function toggle(notification: RemoteWalletNotificationData) {
    try {
      await mutations.setEnabled(notification.id, !notification.enabled)
      toast.success(
        notification.enabled ? 'Notification paused' : 'Notification resumed'
      )
      await Promise.all([notifications.refetch(), deliveries.refetch()])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function retry(deliveryId: string) {
    try {
      await mutations.retry(deliveryId)
      toast.success('Retry queued')
      await deliveries.refetch()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/60 shadow-[0_30px_80px_-60px_hsl(var(--primary))]">
      <div className="relative overflow-hidden border-b border-border/60 p-5">
        <div className="pointer-events-none absolute -right-12 -top-20 size-52 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/25">
              <BellRing className="size-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Wallet notifications</h2>
                <Badge variant="outline">
                  {notifications.data?.notifications.length ?? 0} channels
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Deliver received and forwarded events through audited webhooks
                or signed Nostr events.
              </p>
            </div>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            Add notification
          </Button>
        </div>
      </div>

      <div className="p-5">
        {notifications.loading && !notifications.data ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : notifications.error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Notifications are unavailable.
          </div>
        ) : notifications.data?.notifications.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {notifications.data.notifications.map(notification => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                busy={mutations.loading}
                onToggle={() => void toggle(notification)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-2xl border border-dashed py-12 text-center">
            <BellRing className="size-8 text-muted-foreground" />
            <p className="mt-3 font-medium">No outbound notifications</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Add a webhook or Nostr channel. Delivery only starts with new
              wallet events.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-border/60">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">Delivery journal</h3>
            <p className="text-xs text-muted-foreground">
              Persisted attempts, responses and ambiguous outcomes.
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Radio className="size-3.5 text-emerald-500" /> Live
          </span>
        </div>
        <div className="divide-y border-t">
          {deliveries.loading && !deliveries.data ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : deliveries.data?.deliveries.length ? (
            deliveries.data.deliveries.map(delivery => (
              <DeliveryRow
                key={delivery.id}
                delivery={delivery}
                busy={mutations.loading}
                onInspect={() => setSelected(delivery)}
                onRetry={() => void retry(delivery.id)}
              />
            ))
          ) : (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              Delivery activity will appear here after the next matching wallet
              event.
            </div>
          )}
        </div>
        <CursorPagination
          label="deliveries"
          page={pagination.page}
          hasNext={Boolean(deliveries.data?.nextCursor)}
          loading={deliveries.loading}
          onPrevious={pagination.previous}
          onNext={() => pagination.next(deliveries.data?.nextCursor)}
        />
      </div>

      <CreateNotificationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        loading={mutations.loading}
        onCreate={async input => {
          await mutations.create(input)
          await Promise.all([notifications.refetch(), deliveries.refetch()])
        }}
      />
      <DeliveryDetailDialog
        delivery={selected}
        open={Boolean(selected)}
        onOpenChange={open => !open && setSelected(null)}
      />
    </section>
  )
}

function NotificationCard({
  notification,
  busy,
  onToggle
}: {
  notification: RemoteWalletNotificationData
  busy: boolean
  onToggle: () => void
}) {
  const latest = notification.deliveries[0]
  const channelLabel =
    notification.channel === 'WEBHOOK'
      ? notification.webhookUrl
      : `Kind ${notification.nostrKind}`
  return (
    <article
      className={cn(
        'rounded-2xl border bg-background/35 p-4 transition-colors',
        !notification.enabled && 'opacity-70'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-xl',
              notification.channel === 'WEBHOOK'
                ? 'bg-sky-500/10 text-sky-500'
                : 'bg-violet-500/10 text-violet-400'
            )}
          >
            {notification.channel === 'WEBHOOK' ? (
              <Webhook className="size-4" />
            ) : (
              <Send className="size-4" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold">
                {notification.name}
              </h3>
              <Badge variant={notification.enabled ? 'default' : 'secondary'}>
                {notification.enabled ? 'Live' : 'Paused'}
              </Badge>
            </div>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {channelLabel}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={onToggle}>
          {notification.enabled ? <Pause /> : <Play />}
          {notification.enabled ? 'Pause' : 'Resume'}
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
        <Badge variant="outline">On {notification.action.toLowerCase()}</Badge>
        {notification.nip44 && (
          <Badge variant="outline" className="gap-1">
            <LockKeyhole className="size-3" />
            NIP-44
          </Badge>
        )}
        <span className="ml-auto">
          {latest
            ? `Last: ${latest.status.toLowerCase()}`
            : 'Waiting for first event'}
        </span>
      </div>
    </article>
  )
}

function DeliveryRow({
  delivery,
  busy,
  onInspect,
  onRetry
}: {
  delivery: RemoteWalletNotificationDeliveryData
  busy: boolean
  onInspect: () => void
  onRetry: () => void
}) {
  const retryable =
    delivery.status === 'REJECTED' ||
    delivery.status === 'EXPIRED' ||
    (delivery.status === 'UNKNOWN' &&
      delivery.notification?.channel === 'NOSTR')
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          delivery.status === 'SUCCEEDED'
            ? 'bg-emerald-500/10 text-emerald-500'
            : delivery.status === 'UNKNOWN'
              ? 'bg-amber-500/10 text-amber-500'
              : delivery.status === 'REJECTED' || delivery.status === 'EXPIRED'
                ? 'bg-destructive/10 text-destructive'
                : 'bg-muted text-muted-foreground'
        )}
      >
        {delivery.status === 'SUCCEEDED' ? (
          <CheckCircle2 className="size-4" />
        ) : (
          <Clock3 className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {delivery.notification?.name ?? 'Removed notification'}
          </span>
          <ForwardingStatusBadge status={delivery.status} />
          <Badge variant="outline">{delivery.action}</Badge>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {new Date(delivery.createdAt).toLocaleString()} ·{' '}
          {delivery.attemptCount}{' '}
          {delivery.attemptCount === 1 ? 'attempt' : 'attempts'}
          {delivery.lastError ? ` · ${delivery.lastError}` : ''}
        </p>
      </div>
      <div className="flex gap-2">
        {retryable && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
            <RotateCcw />
            Retry
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onInspect}>
          <Eye />
          Details
        </Button>
      </div>
    </div>
  )
}

function CreateNotificationDialog({
  open,
  onOpenChange,
  loading,
  onCreate
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  onCreate: (input: CreateRemoteWalletNotificationInput) => Promise<void>
}) {
  const [channel, setChannel] = useState<'WEBHOOK' | 'NOSTR'>('WEBHOOK')
  const [name, setName] = useState('')
  const [action, setAction] =
    useState<RemoteWalletNotificationAction>('RECEIVED')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [kind, setKind] = useState('1')
  const [pTag, setPTag] = useState('')
  const [relays, setRelays] = useState('wss://relay.damus.io\nwss://nos.lol')
  const [content, setContent] = useState('{{payload}}')
  const [nip44, setNip44] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      if (!name.trim()) throw new Error('Give this notification a name')
      const input: CreateRemoteWalletNotificationInput =
        channel === 'WEBHOOK'
          ? {
              name: name.trim(),
              channel,
              action,
              webhookUrl: webhookUrl.trim()
            }
          : {
              name: name.trim(),
              channel,
              action,
              kind: Number(kind),
              pTag: pTag.trim(),
              relays: relays.split(/\s+/).filter(Boolean),
              content,
              nip44
            }
      await onCreate(input)
      toast.success('Notification is live')
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add wallet notification</DialogTitle>
            <DialogDescription>
              Choose the event and how LaWallet should deliver its full audit
              payload.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 space-y-5">
            <ToggleGroup
              type="single"
              value={channel}
              onValueChange={value => {
                if (value) setChannel(value as 'WEBHOOK' | 'NOSTR')
              }}
              aria-label="Delivery channel"
              className="grid w-full grid-cols-2"
            >
              <ToggleGroupItem value="WEBHOOK" className="gap-2">
                <Webhook className="size-4" />
                Webhook
              </ToggleGroupItem>
              <ToggleGroupItem value="NOSTR" className="gap-2">
                <Send className="size-4" />
                Nostr
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder="Accounting webhook"
                />
              </Field>
              <Field label="Action">
                <NativeSelect
                  value={action}
                  onChange={event =>
                    setAction(
                      event.target.value as RemoteWalletNotificationAction
                    )
                  }
                >
                  <option value="RECEIVED">Payment received</option>
                  <option value="FORWARDED">Forwarding completed</option>
                </NativeSelect>
              </Field>
            </div>
            {channel === 'WEBHOOK' ? (
              <div className="space-y-3 rounded-2xl border bg-sky-500/[0.04] p-4">
                <Field label="HTTPS endpoint">
                  <Input
                    type="url"
                    value={webhookUrl}
                    onChange={event => setWebhookUrl(event.target.value)}
                    placeholder="https://example.com/hooks/wallet"
                  />
                </Field>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  POST receives the full JSON payload with{' '}
                  <code>Idempotency-Key</code> and <code>X-LaWallet-Event</code>
                  . Keep the first key to deduplicate retries.
                </p>
              </div>
            ) : (
              <div className="space-y-4 rounded-2xl border bg-violet-500/[0.04] p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Event kind">
                    <Input
                      type="number"
                      min={0}
                      value={kind}
                      onChange={event => setKind(event.target.value)}
                    />
                  </Field>
                  <Field label="p tag (hex or npub)">
                    <Input
                      value={pTag}
                      onChange={event => setPTag(event.target.value)}
                      placeholder="npub1…"
                    />
                  </Field>
                </div>
                <Field label="Relays (one per line)">
                  <Textarea
                    value={relays}
                    onChange={event => setRelays(event.target.value)}
                    className="min-h-24"
                  />
                </Field>
                <Field label="Content">
                  <Textarea
                    value={content}
                    onChange={event => setContent(event.target.value)}
                    className="min-h-28"
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Tokens: {'{{payload}}'}, {'{{action}}'}, {'{{walletId}}'},{' '}
                  {'{{paymentHash}}'}, {'{{amountMsats}}'}.
                </p>
                <div className="flex items-center justify-between gap-4 rounded-xl border bg-background/50 p-3">
                  <div>
                    <Label htmlFor="notification-nip44">
                      Encrypt with NIP-44
                    </Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Only the p-tag recipient can read the content.
                    </p>
                  </div>
                  <Switch
                    id="notification-nip44"
                    checked={nip44}
                    onCheckedChange={setNip44}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Spinner className="size-4" />}Create notification
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeliveryDetailDialog({
  delivery,
  open,
  onOpenChange
}: {
  delivery: RemoteWalletNotificationDeliveryData | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code2 className="size-5" />
            Notification delivery{' '}
            {delivery && <ForwardingStatusBadge status={delivery.status} />}
          </DialogTitle>
          <DialogDescription>{delivery?.eventKey}</DialogDescription>
        </DialogHeader>
        {delivery && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Action" value={delivery.action} />
              <Metric label="Attempts" value={String(delivery.attemptCount)} />
              <Metric
                label="Created"
                value={new Date(delivery.createdAt).toLocaleString()}
              />
            </div>
            {delivery.lastError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {delivery.lastError}
              </div>
            )}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                Attempts
              </h4>
              <div className="divide-y rounded-xl border">
                {delivery.attempts.length ? (
                  delivery.attempts.map(attempt => (
                    <div
                      key={attempt.id}
                      className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[100px_1fr_auto]"
                    >
                      <span className="font-medium">
                        Attempt {attempt.attemptNo}
                      </span>
                      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                        {attempt.errorMessage ??
                          attempt.nostrEventId ??
                          attempt.requestId}
                      </span>
                      <Badge
                        variant={
                          attempt.status === 'SUCCEEDED'
                            ? 'default'
                            : attempt.status === 'REJECTED'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {attempt.status}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    No attempt started yet.
                  </div>
                )}
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                Payload snapshot
              </h4>
              <pre className="max-h-80 overflow-auto rounded-xl border bg-black/40 p-4 text-xs leading-relaxed text-zinc-200">
                {JSON.stringify(delivery.payload, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  )
}
