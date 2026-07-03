'use client'

import React from 'react'
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

export default function ListenerPage() {
  const { data, loading } = useApi<ListenerStatusProxyResponse>(
    '/api/admin/listener/status'
  )

  const status = data?.state === 'ok' ? data.status : null
  const activeConnections =
    status?.connections.filter(c => c.state === 'subscribed').length ?? undefined

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="NWC Listener"
        subtitle="Live relay pool — connections, events and webhook deliveries"
      />

      <div className="px-4 py-6 sm:px-6 flex flex-col gap-6">
        {/* Service state banner */}
        {!loading && data?.state === 'disabled' && (
          <Alert>
            <PlugZap className="size-4" />
            <AlertTitle>Listener service not configured</AlertTitle>
            <AlertDescription>
              Set <code>LISTENER_URL</code> and <code>LISTENER_AUTH_SECRET</code>{' '}
              in the web environment (and run the listener service) to keep
              relay connections open, receive payment webhooks and speed up
              card withdraws. The platform works without it — NWC calls fall
              back to per-request relay connections.
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
            </AlertDescription>
          </Alert>
        )}

        {/* Stats */}
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

        {/* Active NWC connections */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            NWC connections
          </h2>
          {loading ? (
            <TableSkeleton rows={4} columns={5} />
          ) : !status || status.connections.length === 0 ? (
            <div className="rounded-md border p-6 text-sm text-muted-foreground">
              {status
                ? 'No active NWC remote wallets to track yet — connections appear here the moment one is added.'
                : 'Connection data unavailable while the listener is offline.'}
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Relay</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Last event</TableHead>
                    <TableHead>Last error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.connections.map(conn => (
                    <TableRow key={conn.walletId}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {conn.walletName || 'Unnamed wallet'}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {truncateHex(conn.walletId)}
                          </span>
                        </div>
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
                        {conn.lastEventAt
                          ? formatRelativeTime(conn.lastEventAt)
                          : '—'}
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
          )}
        </section>

        {/* Recent events */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Recent events
          </h2>
          {loading ? (
            <TableSkeleton rows={4} columns={5} />
          ) : !status || status.recentEvents.length === 0 ? (
            <div className="rounded-md border p-6 text-sm text-muted-foreground">
              {status
                ? 'No NWC events recorded yet.'
                : 'Event history unavailable while the listener is offline.'}
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Webhook</TableHead>
                    <TableHead>Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.recentEvents.map(event => (
                    <TableRow key={event.eventKey}>
                      <TableCell>
                        <Badge variant="outline">{event.type}</Badge>
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {truncateHex(event.walletId)}
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
          )}
        </section>
      </div>
    </div>
  )
}
