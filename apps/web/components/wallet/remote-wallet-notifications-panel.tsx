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
import { useLocale, useT } from '@/lib/client/i18n'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 8

export function RemoteWalletNotificationsPanel({
  walletId
}: {
  walletId: string
}) {
  const rw = useT().remoteWallets
  const n = rw.notifications
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
        notification.enabled ? n.pausedToast : n.resumedToast
      )
      await Promise.all([notifications.refetch(), deliveries.refetch()])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function retry(deliveryId: string) {
    try {
      await mutations.retry(deliveryId)
      toast.success(n.retryQueued)
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
                <h2 className="font-semibold">{n.title}</h2>
                <Badge variant="outline">
                  {n.channels(notifications.data?.notifications.length ?? 0)}
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {n.subtitle}
              </p>
            </div>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            {n.add}
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
            {n.unavailable}
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
            <p className="mt-3 font-medium">{n.emptyTitle}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {n.emptyBody}
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-border/60">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">{n.journal}</h3>
            <p className="text-xs text-muted-foreground">
              {n.journalBody}
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Radio className="size-3.5 text-emerald-500" />{' '}
            {rw.live}
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
              {n.journalEmpty}
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
  const rw = useT().remoteWallets
  const n = rw.notifications
  const latest = notification.deliveries[0]
  const channelLabel =
    notification.channel === 'WEBHOOK'
      ? notification.webhookUrl
      : n.kind(notification.nostrKind ?? '')
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
                {notification.enabled ? rw.live : rw.paused}
              </Badge>
            </div>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {channelLabel}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={onToggle}>
          {notification.enabled ? <Pause /> : <Play />}
          {notification.enabled ? rw.pause : rw.resume}
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
        <Badge variant="outline">
          {n.trigger[notification.action] ??
            `On ${notification.action.toLowerCase()}`}
        </Badge>
        {notification.nip44 && (
          <Badge variant="outline" className="gap-1">
            <LockKeyhole className="size-3" />
            NIP-44
          </Badge>
        )}
        <span className="ml-auto">
          {latest
            ? n.last(latest.status.toLowerCase())
            : n.waitingFirst}
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
  const t = useT()
  const n = t.remoteWallets.notifications
  const locale = useLocale()
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
            {delivery.notification?.name ?? n.removed}
          </span>
          <ForwardingStatusBadge status={delivery.status} />
          <Badge variant="outline">{delivery.action}</Badge>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {new Date(delivery.createdAt).toLocaleString(locale)} ·{' '}
          {n.attemptCount(delivery.attemptCount)}
          {delivery.lastError ? ` · ${delivery.lastError}` : ''}
        </p>
      </div>
      <div className="flex gap-2">
        {retryable && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
            <RotateCcw />
            {t.common.retry}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onInspect}>
          <Eye />
          {n.details}
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
  const t = useT()
  const n = t.remoteWallets.notifications
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
      if (!name.trim()) throw new Error(n.nameRequired)
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
      toast.success(n.liveToast)
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
            <DialogTitle>{n.addTitle}</DialogTitle>
            <DialogDescription>
              {n.addBody}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 space-y-5">
            <ToggleGroup
              type="single"
              value={channel}
              onValueChange={value => {
                if (value) setChannel(value as 'WEBHOOK' | 'NOSTR')
              }}
              aria-label={n.channelLabel}
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
              <Field label={n.name}>
                <Input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder={n.namePlaceholder}
                />
              </Field>
              <Field label={n.action}>
                <NativeSelect
                  value={action}
                  onChange={event =>
                    setAction(
                      event.target.value as RemoteWalletNotificationAction
                    )
                  }
                >
                  <option value="RECEIVED">{n.actionReceived}</option>
                  <option value="FORWARDED">{n.actionForwarded}</option>
                </NativeSelect>
              </Field>
            </div>
            {channel === 'WEBHOOK' ? (
              <div className="space-y-3 rounded-2xl border bg-sky-500/[0.04] p-4">
                <Field label={n.endpoint}>
                  <Input
                    type="url"
                    value={webhookUrl}
                    onChange={event => setWebhookUrl(event.target.value)}
                    placeholder="https://example.com/hooks/wallet"
                  />
                </Field>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {n.webhookHint.before} <code>Idempotency-Key</code>{' '}
                  {n.webhookHint.and} <code>X-LaWallet-Event</code>
                  {n.webhookHint.after}
                </p>
              </div>
            ) : (
              <div className="space-y-4 rounded-2xl border bg-violet-500/[0.04] p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={n.eventKind}>
                    <Input
                      type="number"
                      min={0}
                      value={kind}
                      onChange={event => setKind(event.target.value)}
                    />
                  </Field>
                  <Field label={n.pTag}>
                    <Input
                      value={pTag}
                      onChange={event => setPTag(event.target.value)}
                      placeholder="npub1…"
                    />
                  </Field>
                </div>
                <Field label={n.relays}>
                  <Textarea
                    value={relays}
                    onChange={event => setRelays(event.target.value)}
                    className="min-h-24"
                  />
                </Field>
                <Field label={n.content}>
                  <Textarea
                    value={content}
                    onChange={event => setContent(event.target.value)}
                    className="min-h-28"
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  {n.tokens} {'{{payload}}'}, {'{{action}}'}, {'{{walletId}}'},{' '}
                  {'{{paymentHash}}'}, {'{{amountMsats}}'}.
                </p>
                <div className="flex items-center justify-between gap-4 rounded-xl border bg-background/50 p-3">
                  <div>
                    <Label htmlFor="notification-nip44">
                      {n.encrypt}
                    </Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {n.encryptHint}
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
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Spinner className="size-4" />}
              {n.create}
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
  const rw = useT().remoteWallets
  const n = rw.notifications
  const locale = useLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code2 className="size-5" />
            {n.deliveryTitle}{' '}
            {delivery && <ForwardingStatusBadge status={delivery.status} />}
          </DialogTitle>
          <DialogDescription>{delivery?.eventKey}</DialogDescription>
        </DialogHeader>
        {delivery && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label={n.action} value={delivery.action} />
              <Metric label={n.attempts} value={String(delivery.attemptCount)} />
              <Metric
                label={n.created}
                value={new Date(delivery.createdAt).toLocaleString(locale)}
              />
            </div>
            {delivery.lastError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {delivery.lastError}
              </div>
            )}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {n.attempts}
              </h4>
              <div className="divide-y rounded-xl border">
                {delivery.attempts.length ? (
                  delivery.attempts.map(attempt => (
                    <div
                      key={attempt.id}
                      className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[100px_1fr_auto]"
                    >
                      <span className="font-medium">
                        {rw.attempt(attempt.attemptNo)}
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
                    {n.noAttempt}
                  </div>
                )}
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {n.payload}
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
