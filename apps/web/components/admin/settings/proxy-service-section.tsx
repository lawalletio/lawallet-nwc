'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, RotateCw, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/components/admin/auth-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

interface ProxyConfig {
  enabled: boolean
  feeBps: number
  walletId: string
  hasNwc: boolean
  hasReceiptNsec: boolean
  receiptPubkey: string | null
  vaultConfigured: boolean
  listenerEnabled: boolean
  outstandingPayments: number
  capabilities: {
    methods?: string[]
    notifications?: string[]
  } | null
  balanceMsats: string | null
  lastProbeAt: string | null
  lastProbeError: string | null
  lastListenerSeenAt: string | null
  lastCronAt: string | null
}

interface ProxyPaymentRow {
  id: string
  username: string
  destination: string
  status: string
  grossAmountMsats: string
  serviceFeeMsats: string
  destinationAmountMsats: string
  routingFeeMsats: string | null
  nextRetryAt: string
  lastError: string | null
  currentAttempt: {
    bolt11: string
    attemptNo: number
    status: string
    expiresAt: string
    error: string | null
  } | null
  attemptCount: number
}

export function ProxyServiceSection() {
  const { apiClient } = useAuth()
  const [config, setConfig] = useState<ProxyConfig | null>(null)
  const [payments, setPayments] = useState<ProxyPaymentRow[]>([])
  const [nwcUri, setNwcUri] = useState('')
  const [receiptNsec, setReceiptNsec] = useState('')
  const [feePercent, setFeePercent] = useState('0.50')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const load = useCallback(async () => {
    const [nextConfig, queue] = await Promise.all([
      apiClient.get<ProxyConfig>('/api/settings/lud16-proxy'),
      apiClient.get<{ payments: ProxyPaymentRow[] }>(
        '/api/settings/lud16-proxy/payments'
      )
    ])
    setConfig(nextConfig)
    setFeePercent((nextConfig.feeBps / 100).toFixed(2))
    setPayments(queue.payments)
  }, [apiClient])

  useEffect(() => {
    void load()
      .catch(err =>
        toast.error(err instanceof Error ? err.message : 'Failed to load proxy')
      )
      .finally(() => setLoading(false))
  }, [load])

  async function save(patch: Record<string, unknown>) {
    setSaving(true)
    try {
      await apiClient.put('/api/settings/lud16-proxy', patch)
      setNwcUri('')
      setReceiptNsec('')
      await load()
      toast.success('Proxy settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save proxy')
    } finally {
      setSaving(false)
    }
  }

  async function testProxy() {
    setTesting(true)
    try {
      const result = await apiClient.post<{
        ok: boolean
        balanceMsats?: number
        error?: string
      }>('/api/settings/lud16-proxy/test')
      if (!result.ok) throw new Error(result.error || 'Proxy test failed')
      toast.success(
        `Proxy wallet ready (${formatSats(String(result.balanceMsats ?? 0))} sats)`
      )
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Proxy test failed')
    } finally {
      setTesting(false)
    }
  }

  async function retry(id: string) {
    try {
      await apiClient.post(
        `/api/settings/lud16-proxy/payments/${encodeURIComponent(id)}/retry`
      )
      await load()
      toast.success('Settlement queued for retry')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed')
    }
  }

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size={24} />
      </div>
    )
  }

  const canEnable =
    config.vaultConfigured &&
    config.listenerEnabled &&
    (config.hasNwc || nwcUri.trim().length > 0) &&
    (config.hasReceiptNsec || receiptNsec.trim().length > 0)

  return (
    <>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[280px_1fr]">
        <div>
          <h3 className="text-sm font-semibold">Lightning Address proxy</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Receive locally, retain the configured fee, and forward only after
            the payer invoice settles.
          </p>
        </div>
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Enable deferred forwarding</p>
              <p className="text-xs text-muted-foreground">
                Requires the listener and NWC_VAULT_SECRET on both services.
              </p>
            </div>
            <Switch
              checked={config.enabled}
              disabled={saving || (!config.enabled && !canEnable)}
              onCheckedChange={enabled =>
                void save({
                  enabled,
                  ...(enabled && nwcUri ? { nwcUri } : {}),
                  ...(enabled && receiptNsec ? { receiptNsec } : {}),
                  ...(enabled
                    ? { feeBps: Math.round(Number(feePercent) * 100) }
                    : {})
                })
              }
            />
          </div>

          {!config.vaultConfigured && (
            <p className="text-xs text-destructive">
              NWC_VAULT_SECRET is not configured on the web service.
            </p>
          )}
          {!config.listenerEnabled && (
            <p className="text-xs text-destructive">
              Enable the NWC listener before enabling the proxy.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="proxy-nwc">Proxy NWC URI</Label>
            <Input
              id="proxy-nwc"
              type="password"
              value={nwcUri}
              placeholder={
                config.hasNwc
                  ? '(configured — enter to rotate)'
                  : 'nostr+walletconnect://…'
              }
              onChange={event => setNwcUri(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proxy-nsec">Zap receipt signer</Label>
            <Input
              id="proxy-nsec"
              type="password"
              value={receiptNsec}
              placeholder={
                config.hasReceiptNsec
                  ? '(configured — enter to rotate)'
                  : 'nsec1… or 64-character hex'
              }
              onChange={event => setReceiptNsec(event.target.value)}
            />
            {config.receiptPubkey && (
              <p className="break-all font-mono text-xs text-muted-foreground">
                pubkey {config.receiptPubkey}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="proxy-fee">Service fee (%)</Label>
            <Input
              id="proxy-fee"
              type="number"
              min="0"
              max="10"
              step="0.01"
              value={feePercent}
              onChange={event => setFeePercent(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={saving}
              onClick={() =>
                void save({
                  feeBps: Math.round(Number(feePercent) * 100),
                  ...(nwcUri ? { nwcUri } : {}),
                  ...(receiptNsec ? { receiptNsec } : {})
                })
              }
            >
              Save proxy
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={testing || !config.hasNwc}
              onClick={() => void testProxy()}
            >
              {testing ? <Spinner size={16} /> : <Zap className="size-4" />}
              Test wallet
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">
              {config.outstandingPayments} outstanding
            </Badge>
            <span>
              Balance:{' '}
              {config.balanceMsats
                ? `${formatSats(config.balanceMsats)} sats`
                : 'not probed'}
            </span>
            <span>
              Listener:{' '}
              {config.lastListenerSeenAt
                ? new Date(config.lastListenerSeenAt).toLocaleString()
                : 'not yet'}
            </span>
            <span>
              Last cron:{' '}
              {config.lastCronAt
                ? new Date(config.lastCronAt).toLocaleString()
                : 'not yet'}
            </span>
          </div>
          {config.capabilities?.methods && (
            <p className="text-xs text-muted-foreground">
              NWC methods: {config.capabilities.methods.join(', ')}
            </p>
          )}
          {config.lastProbeError && (
            <p className="text-xs text-destructive">
              Last capability probe: {config.lastProbeError}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Settlement queue</h3>
          <p className="text-sm text-muted-foreground">
            Source receipt, retained fee, destination invoice, and retry state.
          </p>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Gross / fee / net</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Destination invoice</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No proxy settlements yet.
                  </TableCell>
                </TableRow>
              ) : (
                payments.map(payment => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-mono">
                      {payment.username}
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-mono">
                      {payment.destination}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatSats(payment.grossAmountMsats)} /{' '}
                      {formatSats(payment.serviceFeeMsats)} /{' '}
                      {formatSats(payment.destinationAmountMsats)} sats
                      {payment.routingFeeMsats && (
                        <span className="block text-muted-foreground">
                          Routing fee {formatSats(payment.routingFeeMsats)} sats
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{payment.status}</Badge>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Next retry{' '}
                        {new Date(payment.nextRetryAt).toLocaleString()}
                      </p>
                      {payment.lastError && (
                        <p
                          className="mt-1 max-w-52 truncate text-xs text-destructive"
                          title={payment.lastError}
                        >
                          {payment.lastError}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {payment.currentAttempt
                        ? `#${payment.currentAttempt.attemptNo}/${payment.attemptCount} ${payment.currentAttempt.status} · expires ${new Date(payment.currentAttempt.expiresAt).toLocaleString()}`
                        : 'Not requested yet'}
                      {payment.currentAttempt && (
                        <p
                          className="max-w-52 truncate font-mono text-[10px] text-muted-foreground"
                          title={payment.currentAttempt.bolt11}
                        >
                          {payment.currentAttempt.bolt11}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!['COMPLETED', 'EXPIRED'].includes(payment.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void retry(payment.id)}
                        >
                          <RotateCw className="size-4" />
                          Retry
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  )
}

function formatSats(msats: string): string {
  const value = Number(msats) / 1000
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 3 })
    : '—'
}
