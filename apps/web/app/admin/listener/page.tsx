'use client'

import React, { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { StatCard } from '@/components/admin/stat-card'
import { DataTablePagination } from '@/components/admin/data-table-pagination'
import { TableSkeleton } from '@/components/admin/skeletons/table-skeleton'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useApi } from '@/lib/client/hooks/use-api'
import { formatRelativeTime, truncateHex } from '@/lib/client/format'
import type {
  ListenerConnection,
  ListenerRecentEvent,
  ListenerStatusProxyResponse,
  ListenerStatusResponse,
} from '@lawallet-nwc/shared'

const STATE_BADGE: Record<
  ListenerConnection['state'],
  { label: string; className: string }
> = {
  subscribed: { label: 'Subscribed', className: 'bg-green-500/15 text-green-600' },
  connecting: { label: 'Connecting', className: 'bg-yellow-500/15 text-yellow-600' },
  error: { label: 'Error', className: 'bg-red-500/15 text-red-600' },
  closed: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
}

const WEBHOOK_BADGE: Record<
  ListenerRecentEvent['webhookStatus'],
  { label: string; className: string }
> = {
  delivered: { label: 'Delivered', className: 'bg-green-500/15 text-green-600' },
  pending: { label: 'Pending', className: 'bg-yellow-500/15 text-yellow-600' },
  failed: { label: 'Failed', className: 'bg-red-500/15 text-red-600' },
}

function relayHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

/** Shared link target: the remote wallet behind an NWC connection. */
function walletHref(walletId: string): string {
  return `/admin/remote-wallets/${walletId}`
}

const PAGE_SIZE = 20

/** ISO timestamp → epoch ms (0 when null/absent, so it sorts last). */
function tsMs(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : 0
}

/** A connection's most recent activity across event / error / catch-up. */
function connLastActivity(c: ListenerConnection): number {
  return Math.max(tsMs(c.lastEventAt), tsMs(c.lastErrorAt), tsMs(c.lastCatchupAt))
}

/**
 * Client-side pagination for a pre-sorted list. The page is display-clamped to
 * the current row count so a shrinking live feed never lands on an empty page.
 */
function usePaginatedRows<T>(rows: T[]): {
  pageRows: T[]
  page: number
  totalPages: number
  setPage: (p: number) => void
} {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  return { pageRows, page: safePage, totalPages, setPage }
}

/** How often the dashboard re-polls the listener status (realtime feel). */
const POLL_MS = 6000

type ConnState =
  | 'loading'
  | 'connected'
  | 'degraded'
  | 'reconnecting'
  | 'unreachable'
  | 'disabled'

/**
 * Realtime connection state for the indicator. `reconnecting` (transient
 * unreachable while we still hold a last-good snapshot) is deliberately
 * distinct from `unreachable` (never answered) so a slow-host blip doesn't
 * read as an outage. `degraded` = the listener answered but flagged part of
 * its `/status` stale (e.g. the DB-backed events feed).
 */
function getConnState(
  data: ListenerStatusProxyResponse | null,
  loading: boolean,
  lastGood: ListenerStatusResponse | null
): ConnState {
  if (!data) return loading ? 'loading' : 'loading'
  if (data.state === 'disabled') return 'disabled'
  if (data.state === 'unreachable') return lastGood ? 'reconnecting' : 'unreachable'
  return data.status.degraded && data.status.degraded.length > 0
    ? 'degraded'
    : 'connected'
}

const CONN_META: Record<
  ConnState,
  { label: string; dot: string; text: string; pulse: boolean }
> = {
  loading: { label: 'Checking…', dot: 'bg-muted-foreground', text: 'text-muted-foreground', pulse: true },
  connected: { label: 'Connected', dot: 'bg-green-500', text: 'text-green-600', pulse: true },
  degraded: { label: 'Connected · feed degraded', dot: 'bg-yellow-500', text: 'text-yellow-600', pulse: true },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-yellow-500', text: 'text-yellow-600', pulse: true },
  unreachable: { label: 'Unreachable', dot: 'bg-red-500', text: 'text-red-600', pulse: false },
  disabled: { label: 'Not configured', dot: 'bg-muted-foreground', text: 'text-muted-foreground', pulse: false },
}

/**
 * Live listener-connection indicator — a pulsing status dot that reflects the
 * REAL current state each poll, plus a one-line detail. Stays visible across
 * all tabs so you can always tell whether the feed you're seeing is live.
 */
function ConnectionStatusBanner({
  state,
  status,
  error,
}: {
  state: ConnState
  status: ListenerStatusResponse | null
  error?: string
}) {
  const meta = CONN_META[state]
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
      <span className="relative mt-1 flex size-2.5 shrink-0">
        {meta.pulse && (
          <span
            className={cn(
              'absolute inline-flex size-full animate-ping rounded-full opacity-75',
              meta.dot
            )}
          />
        )}
        <span className={cn('relative inline-flex size-2.5 rounded-full', meta.dot)} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-semibold', meta.text)}>
            Listener {meta.label}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            live
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {state === 'connected' && status && (
            <>
              Up {formatUptime(status.uptimeSeconds)} ·{' '}
              {status.counters.webhooksDelivered} webhooks delivered
              {status.counters.webhooksFailed > 0 &&
                ` · ${status.counters.webhooksFailed} failed`}
              {(status.counters.eventsRecovered ?? 0) > 0 &&
                ` · ${status.counters.eventsRecovered} recovered`}
            </>
          )}
          {state === 'degraded' &&
            'The listener is up but part of its status feed is momentarily unavailable — showing the last-known state.'}
          {state === 'reconnecting' &&
            'Not answering right now — showing the last-known state and retrying every few seconds.'}
          {state === 'unreachable' &&
            (error
              ? `The service is configured but not answering: ${error}`
              : 'The service is configured but not answering.')}
          {state === 'loading' && 'Checking the listener…'}
          {state === 'disabled' && (
            <>
              Enable it in{' '}
              <Link
                href="/admin/settings?tab=nwc-services"
                className="underline underline-offset-2"
              >
                Settings → NWC Services
              </Link>{' '}
              to keep relay connections open. The platform works without it.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

export default function ListenerPage() {
  return (
    <Suspense>
      <ListenerContent />
    </Suspense>
  )
}

function ListenerContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeTab = searchParams.get('tab') || 'connections'
  const { data, loading, refetch } = useApi<ListenerStatusProxyResponse>(
    '/api/admin/listener/status'
  )

  // Keep the dashboard live. useApi only auto-refetches on webhook SSE events,
  // so between payments the view goes stale and a single slow/timed-out fetch
  // would blank the whole feed — the cause of "events sometimes vanish". Poll
  // to stay current and recover from transient blips.
  useEffect(() => {
    const id = setInterval(() => void refetch(), POLL_MS)
    return () => clearInterval(id)
  }, [refetch])

  const current = data?.state === 'ok' ? data.status : null

  // Sticky last-good snapshot so a transient `unreachable` (or a degraded
  // events feed) doesn't flicker the tables empty. Uses React's "adjust state
  // during render" pattern to record the last HEALTHY status; the live
  // indicator still reflects the REAL current state.
  const [lastGood, setLastGood] = useState<ListenerStatusResponse | null>(null)
  if (
    current &&
    !current.degraded?.includes('recentEvents') &&
    current !== lastGood
  ) {
    setLastGood(current)
  }

  const snapshot = current ?? lastGood
  const events =
    current && !current.degraded?.includes('recentEvents')
      ? current.recentEvents
      : lastGood?.recentEvents ?? snapshot?.recentEvents ?? []
  const view: ListenerStatusResponse | null = snapshot
    ? { ...snapshot, recentEvents: events }
    : null

  const connState = getConnState(data, loading, lastGood)
  // Skeletons only on the very first load (no data yet); polls never flash.
  const firstLoad = loading && !view
  const offline = !loading && !view
  const activeConnections =
    view?.connections.filter(c => c.state === 'subscribed').length ?? undefined
  const liveRelays = view
    ? view.relays.filter(r => r.connected).length
    : undefined

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="NWC Listener"
        subtitle="Live relay pool — connections, events and webhook deliveries"
        tabs={[
          {
            label: 'NWC connections',
            active: activeTab === 'connections',
            onClick: () => router.push('/admin/listener?tab=connections'),
          },
          {
            label: 'Realtime events',
            active: activeTab === 'events',
            onClick: () => router.push('/admin/listener?tab=events'),
          },
          {
            label: 'Relay connections',
            active: activeTab === 'relays',
            onClick: () => router.push('/admin/listener?tab=relays'),
            badge: liveRelays,
          },
        ]}
      />

      <div className="px-4 py-6 sm:px-6 flex flex-col gap-6">
        {/* Realtime listener-connection status — visible across all tabs */}
        <ConnectionStatusBanner
          state={connState}
          status={view}
          error={data?.state === 'unreachable' ? data.error : undefined}
        />

        {/* Stats — always visible across tabs */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <StatCard
            title="Active connections"
            titleMobile="Connections"
            value={activeConnections}
            description="NWC wallets with a live relay subscription"
            loading={firstLoad}
          />
          <StatCard
            title="Relays"
            value={view?.relays.length}
            description="Distinct relay endpoints held open"
            loading={firstLoad}
          />
          <StatCard
            title="Events processed"
            titleMobile="Events"
            value={view?.counters.eventsReceived}
            description="NWC notifications since last restart"
            loading={firstLoad}
          />
        </div>

        {activeTab === 'connections' && (
          <ConnectionsTable status={view} loading={firstLoad} offline={offline} />
        )}
        {activeTab === 'events' && (
          <EventsTable status={view} loading={firstLoad} offline={offline} />
        )}
        {activeTab === 'relays' && (
          <RelaysTable status={view} loading={firstLoad} offline={offline} />
        )}
      </div>
    </div>
  )
}

interface TabProps {
  status: ListenerStatusResponse | null
  loading: boolean
  offline: boolean
}

function EmptyState({ offline, message }: { offline: boolean; message: string }) {
  return (
    <div className="rounded-md border p-6 text-sm text-muted-foreground">
      {offline ? 'Data unavailable while the listener is offline.' : message}
    </div>
  )
}

function ConnectionsTable({ status, loading, offline }: TabProps) {
  // Most recent activity first (event / error / catch-up), then paginate.
  const sorted = useMemo(
    () =>
      status
        ? [...status.connections].sort(
            (a, b) => connLastActivity(b) - connLastActivity(a)
          )
        : [],
    [status]
  )
  const { pageRows, page, totalPages, setPage } = usePaginatedRows(sorted)

  if (loading) return <TableSkeleton rows={4} columns={6} />
  if (!status || status.connections.length === 0) {
    return (
      <EmptyState
        offline={offline || !status}
        message="No active NWC remote wallets to track yet — connections appear here the moment one is added."
      />
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Wallet</TableHead>
              <TableHead>Relay</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Last event</TableHead>
              <TableHead>Last catch-up</TableHead>
              <TableHead>Last error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map(conn => (
              <TableRow key={conn.walletId}>
              <TableCell>
                <Link href={walletHref(conn.walletId)} className="group flex flex-col">
                  <span className="font-medium group-hover:underline underline-offset-2">
                    {conn.walletName || 'Unnamed wallet'}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {truncateHex(conn.walletId)}
                  </span>
                </Link>
              </TableCell>
              <TableCell className="text-sm">
                {conn.relayUrls.map(relayHost).join(', ') || '—'}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={STATE_BADGE[conn.state].className}
                >
                  {STATE_BADGE[conn.state].label}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {conn.lastEventAt ? formatRelativeTime(conn.lastEventAt) : '—'}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {conn.lastCatchupAt ? formatRelativeTime(conn.lastCatchupAt) : '—'}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-[240px] truncate">
                {conn.lastError
                  ? `${formatRelativeTime(conn.lastErrorAt)} · ${conn.lastError}`
                  : '—'}
              </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  )
}

function EventsTable({ status, loading, offline }: TabProps) {
  // Newest received first (the backend already returns this order), paginated.
  const sorted = useMemo(
    () =>
      status
        ? [...status.recentEvents].sort(
            (a, b) => tsMs(b.receivedAt) - tsMs(a.receivedAt)
          )
        : [],
    [status]
  )
  const { pageRows, page, totalPages, setPage } = usePaginatedRows(sorted)

  if (loading) return <TableSkeleton rows={4} columns={5} />
  if (!status || status.recentEvents.length === 0) {
    return (
      <EmptyState
        offline={offline || !status}
        message="No NWC events recorded yet — payments received and sent stream in here in realtime."
      />
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>NWC connection</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Webhook</TableHead>
              <TableHead>Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map(event => (
              <TableRow key={event.eventKey}>
              <TableCell>
                <span className="inline-flex items-center gap-1.5">
                  <Badge variant="outline">{event.type}</Badge>
                  {event.recovered && (
                    <Badge
                      variant="outline"
                      className="bg-sky-500/15 text-sky-600"
                    >
                      Recovered
                    </Badge>
                  )}
                </span>
              </TableCell>
              <TableCell className="text-sm">
                <Link
                  href={walletHref(event.walletId)}
                  className="hover:underline underline-offset-2"
                >
                  {event.walletName || (
                    <span className="font-mono">{truncateHex(event.walletId)}</span>
                  )}
                </Link>
              </TableCell>
              <TableCell className="text-sm">
                {event.amountMsats !== null
                  ? `⚡ ${Math.floor(event.amountMsats / 1000)} sats`
                  : '—'}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={WEBHOOK_BADGE[event.webhookStatus].className}
                >
                  {WEBHOOK_BADGE[event.webhookStatus].label}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatRelativeTime(event.receivedAt)}
              </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  )
}

function RelaysTable({ status, loading, offline }: TabProps) {
  // No per-relay timestamp, so "most active" = live (connected) first, then
  // the busiest by NWC subscription count. Paginated like the other tabs.
  const sorted = useMemo(
    () =>
      status
        ? [...status.relays].sort(
            (a, b) =>
              Number(b.connected) - Number(a.connected) ||
              b.walletCount - a.walletCount
          )
        : [],
    [status]
  )
  const { pageRows, page, totalPages, setPage } = usePaginatedRows(sorted)

  if (loading) return <TableSkeleton rows={3} columns={3} />
  if (!status || status.relays.length === 0) {
    return (
      <EmptyState
        offline={offline || !status}
        message="No relay connections yet — relays appear as soon as an NWC wallet subscribes."
      />
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Relay</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>NWC subscriptions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map(relay => (
              <TableRow key={relay.url}>
                <TableCell className="text-sm font-mono">{relay.url}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      relay.connected
                        ? 'bg-green-500/15 text-green-600'
                        : 'bg-red-500/15 text-red-600'
                    }
                  >
                    {relay.connected ? 'Connected' : 'Disconnected'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{relay.walletCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  )
}
