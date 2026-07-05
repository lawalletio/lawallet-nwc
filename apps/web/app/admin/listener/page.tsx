'use client'

import React, { Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, PlugZap, RadioTower } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { StatCard } from '@/components/admin/stat-card'
import { TableSkeleton } from '@/components/admin/skeletons/table-skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
  const { data, loading } = useApi<ListenerStatusProxyResponse>(
    '/api/admin/listener/status'
  )

  const status = data?.state === 'ok' ? data.status : null
  const offline = !loading && !status
  const activeConnections =
    status?.connections.filter(c => c.state === 'subscribed').length ?? undefined

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
          },
        ]}
      />

      <div className="px-4 py-6 sm:px-6 flex flex-col gap-6">
        {/* Service state banner — always visible across tabs */}
        {!loading && data?.state === 'disabled' && (
          <Alert>
            <PlugZap className="size-4" />
            <AlertTitle>Listener service not configured</AlertTitle>
            <AlertDescription>
              Enable the listener in{' '}
              <Link
                href="/admin/settings?tab=nwc-services"
                className="underline underline-offset-2"
              >
                Settings → NWC Services
              </Link>{' '}
              to keep relay connections open, receive payment webhooks and
              speed up card withdraws. The platform works without it — NWC
              calls fall back to per-request relay connections.
            </AlertDescription>
          </Alert>
        )}
        {!loading && data?.state === 'unreachable' && (
          <Alert variant="destructive">
            <RadioTower className="size-4" />
            <AlertTitle>Listener unreachable</AlertTitle>
            <AlertDescription>
              The service is configured but not answering: {data.error}
            </AlertDescription>
          </Alert>
        )}
        {status && (
          <Alert>
            <CheckCircle2 className="size-4 text-green-600" />
            <AlertTitle>Listener connected</AlertTitle>
            <AlertDescription>
              Up {formatUptime(status.uptimeSeconds)} · started{' '}
              {formatRelativeTime(status.startedAt)} ·{' '}
              {status.counters.webhooksDelivered} webhooks delivered
              {status.counters.webhooksFailed > 0 &&
                ` · ${status.counters.webhooksFailed} failed`}
              {(status.counters.eventsRecovered ?? 0) > 0 &&
                ` · ${status.counters.eventsRecovered} recovered`}
            </AlertDescription>
          </Alert>
        )}

        {/* Stats — always visible across tabs */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <StatCard
            title="Active connections"
            titleMobile="Connections"
            value={activeConnections}
            description="NWC wallets with a live relay subscription"
            loading={loading}
          />
          <StatCard
            title="Relays"
            value={status?.relays.length}
            description="Distinct relay endpoints held open"
            loading={loading}
          />
          <StatCard
            title="Events processed"
            titleMobile="Events"
            value={status?.counters.eventsReceived}
            description="NWC notifications since last restart"
            loading={loading}
          />
        </div>

        {activeTab === 'connections' && (
          <ConnectionsTable status={status} loading={loading} offline={offline} />
        )}
        {activeTab === 'events' && (
          <EventsTable status={status} loading={loading} offline={offline} />
        )}
        {activeTab === 'relays' && (
          <RelaysTable status={status} loading={loading} offline={offline} />
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
          {status.connections.map(conn => (
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
  )
}

function EventsTable({ status, loading, offline }: TabProps) {
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
          {status.recentEvents.map(event => (
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
  )
}

function RelaysTable({ status, loading, offline }: TabProps) {
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
          {status.relays.map(relay => (
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
  )
}
