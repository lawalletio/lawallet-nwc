'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  ShieldCheck
} from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { InputWithQrScanner } from '@/components/ui/input-with-qr-scanner'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi, withQuery } from '@/lib/client/hooks/use-api'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import {
  formatDateTime,
  formatMsats,
  humanizeStatus,
  truncateNpub
} from '@/lib/client/format'
import { cn } from '@/lib/utils'
import {
  decodeInvoiceFields,
  normalizeInvoice,
  type DecodedInvoiceFields
} from '@/lib/decode-invoice'
import type { InvoiceLookupResult } from '@/lib/invoice-lookup'

type LookupUser = NonNullable<
  NonNullable<InvoiceLookupResult['local']['invoice']>['user']
>

type Decoded =
  | { state: 'empty' }
  | { state: 'invalid'; message: string }
  | {
      state: 'ok'
      invoice: string
      fields: DecodedInvoiceFields
      expired: boolean
    }

/** Decoding is local and synchronous, so it runs on every keystroke. */
function decodeInput(raw: string): Decoded {
  if (!raw.trim()) return { state: 'empty' }
  try {
    const fields = decodeInvoiceFields(raw)
    return {
      state: 'ok',
      invoice: normalizeInvoice(raw),
      fields,
      expired: !!fields.expiresAt && Date.parse(fields.expiresAt) < Date.now()
    }
  } catch {
    return {
      state: 'invalid',
      message: 'Not a valid bolt11 invoice — check that it was pasted whole.'
    }
  }
}

const ENTER = 'animate-in fade-in slide-in-from-bottom-2 duration-300'

export default function InvoiceLookupPage() {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [decoded, setDecoded] = useState<Decoded>({ state: 'empty' })

  function change(value: string) {
    setInput(value)
    setDecoded(decodeInput(value))
  }

  // The server lookup only fires for input that already decodes locally.
  const lookupFor = useDebouncedValue(
    decoded.state === 'ok' ? decoded.invoice : null,
    250
  )
  const { data, error } = useApi<InvoiceLookupResult>(
    lookupFor
      ? withQuery('/api/admin/tools/invoice', { invoice: lookupFor })
      : null
  )
  const current = decoded.state === 'ok' ? decoded.invoice : null
  // Ignore a stale response for a previously pasted invoice.
  const result = data && data.invoice === current ? data : null
  const lookupError = current && lookupFor === current ? error : null

  return (
    <div className="flex flex-col">
      <AdminTopbar
        type="subpage"
        title="Lightning Invoice lookup"
        subtitle="Paste a bolt11 to decode it and find everything we know about it."
        onBack={() => router.push('/admin/tools')}
      />
      <div className="flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1.5">
          <InputWithQrScanner
            value={input}
            onChange={change}
            onScan={change}
            placeholder="Paste or scan an invoice (lnbc…)"
            aria-label="Lightning invoice"
            aria-invalid={decoded.state === 'invalid'}
            autoFocus
            className="font-mono text-xs"
          />
          {decoded.state === 'invalid' && (
            <p
              className={cn(
                'flex items-center gap-1.5 text-xs text-destructive',
                ENTER
              )}
            >
              <AlertCircle className="size-3.5" />
              {decoded.message}
            </p>
          )}
        </div>

        {decoded.state === 'ok' && (
          <div key={decoded.invoice} className="flex flex-col gap-4">
            <SummaryCard
              decoded={decoded}
              result={result}
              failed={!!lookupError}
            />
            {lookupError ? (
              <LookupError message={lookupError.message} />
            ) : result ? (
              <LookupResult data={result} />
            ) : (
              <LookupSkeleton />
            )}
            <DetailsCard
              fields={decoded.fields}
              payeeNodeKey={result?.decoded.payeeNodeKey}
              verifying={!result && !lookupError}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  decoded,
  result,
  failed
}: {
  decoded: Extract<Decoded, { state: 'ok' }>
  result: InvoiceLookupResult | null
  failed: boolean
}) {
  const { fields, expired } = decoded
  const localStatus = result?.local.invoice?.status
  return (
    <Card className={ENTER}>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-3xl font-semibold tracking-tight tabular-nums">
              {fields.amountMsats ? formatMsats(fields.amountMsats) : 'Any amount'}
            </p>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {fields.description ||
                (fields.descriptionHash
                  ? 'Description committed by hash'
                  : 'No description')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                'gap-1',
                expired
                  ? 'border-destructive/40 text-destructive'
                  : 'border-green-500/40 text-green-600'
              )}
            >
              <Clock className="size-3" />
              {expired ? 'Expired' : 'Unexpired'}
            </Badge>
            {result ? (
              <Badge
                className={cn(
                  'animate-in fade-in zoom-in-95 duration-300',
                  result.isLocal
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground'
                )}
              >
                {result.isLocal
                  ? `Local${localStatus ? ` · ${humanizeStatus(localStatus)}` : ''}`
                  : 'External'}
              </Badge>
            ) : failed ? null : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Looking up…
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Created {formatDateTime(fields.createdAt, '—')}</span>
          <span>
            {expired ? 'Expired' : 'Expires'}{' '}
            {formatDateTime(fields.expiresAt, '—')}
          </span>
          {fields.network && <span>Network {fields.network}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

function LookupSkeleton() {
  return (
    <Card className={ENTER} aria-busy="true">
      <CardHeader>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Searching local records and the Lightning graph…
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {[40, 64, 52, 72].map((w, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-28 shrink-0" />
            <Skeleton className="h-4" style={{ width: `${w}%` }} />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function LookupError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive',
        ENTER
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function DetailsCard({
  fields,
  payeeNodeKey,
  verifying
}: {
  fields: DecodedInvoiceFields
  payeeNodeKey: string | null | undefined
  verifying: boolean
}) {
  return (
    <Section
      title="Invoice details"
      description="Decoded in your browser."
      badges={
        payeeNodeKey ? (
          <Badge
            variant="outline"
            className="animate-in fade-in gap-1 border-green-500/40 text-green-600 duration-300"
          >
            <ShieldCheck className="size-3" />
            Signature verified
          </Badge>
        ) : null
      }
    >
      <Field label="Payment hash" value={fields.paymentHash} mono copy />
      {verifying ? (
        <Row label="Payee node">
          <Skeleton className="h-4 w-3/4" />
        </Row>
      ) : (
        <Field label="Payee node" value={payeeNodeKey} mono copy />
      )}
      <Field label="Description hash" value={fields.descriptionHash} mono />
      <Field label="Payment secret" value={fields.paymentSecret} mono />
      <Field
        label="Min final CLTV"
        value={fields.minFinalCltvExpiry?.toString()}
      />
      <Field
        label="Features"
        value={fields.features.length ? fields.features.join(', ') : null}
      />
      {fields.routeHints.map((hop, i) => (
        <Field
          key={i}
          label={`Route hint ${i + 1}`}
          value={`${hop.pubkey} · ${hop.shortChannelId} · ${hop.feeBaseMsat} msat + ${hop.feeProportionalMillionths} ppm · Δ${hop.cltvExpiryDelta}`}
          mono
        />
      ))}
    </Section>
  )
}

function LookupResult({ data }: { data: InvoiceLookupResult }) {
  const { local, node } = data
  const received = local.invoice
  const hasPayments = local.cardPayments.length > 0 || local.swaps.length > 0

  return (
    <>
      {received && (
        <Section
          icon={<ArrowDownLeft className="size-4 text-green-600" />}
          title="Received here"
          description="Minted by this instance for one of its users."
          badges={<Badge>{humanizeStatus(received.status)}</Badge>}
        >
          <UserField user={received.user} />
          <Field
            label="Wallet"
            value={
              received.remoteWallet &&
              `${received.remoteWallet.name} · ${received.remoteWallet.type} · ${humanizeStatus(received.remoteWallet.status)}`
            }
            href={
              received.remoteWallet &&
              `/admin/remote-wallets/${received.remoteWallet.id}`
            }
          />
          <Field label="Purpose" value={humanizeStatus(received.purpose)} />
          <Field label="Preimage" value={received.preimage} mono copy />
          <Field label="Paid" value={formatDateTime(received.paidAt, '')} />
          <Field label="Zap receipt" value={received.zapReceiptEventId} mono />
          <Field
            label="Metadata"
            value={
              received.metadata ? JSON.stringify(received.metadata) : null
            }
            mono
          />
          {received.proxyPayment && (
            <>
              <Field
                label="Proxy forward"
                value={`${humanizeStatus(received.proxyPayment.status)} → ${received.proxyPayment.destination}`}
              />
              <Field
                label="Proxy preimage"
                value={received.proxyPayment.sourcePreimage}
                mono
                copy
              />
              <Field
                label="Proxy error"
                value={received.proxyPayment.lastError}
              />
            </>
          )}
        </Section>
      )}

      {hasPayments && (
        <Section
          icon={<ArrowUpRight className="size-4 text-orange-500" />}
          title="Paid from here"
          description="Local cards or swaps that paid this invoice."
        >
          {local.cardPayments.map(p => (
            <React.Fragment key={p.id}>
              <Field
                label="Card"
                value={`${p.card.title ?? p.card.id} · ${humanizeStatus(p.status)} · ${p.transport}`}
                href={`/admin/cards/${p.card.id}`}
              />
              <UserField user={p.card.user} />
              <Field
                label="Wallet"
                value={p.walletId}
                href={`/admin/remote-wallets/${p.walletId}`}
                mono
              />
              <Field label="Amount" value={formatMsats(p.amountMsats)} />
              <Field
                label="Fees"
                value={
                  p.feesPaidMsats !== null
                    ? formatMsats(String(p.feesPaidMsats))
                    : null
                }
              />
              <Field label="Preimage" value={p.preimage} mono copy />
              <Field label="Error" value={p.errorCode} />
              <Field label="Tapped" value={formatDateTime(p.createdAt, '')} />
            </React.Fragment>
          ))}
          {local.swaps.map(s => (
            <React.Fragment key={s.id}>
              <Field
                label="Swap"
                value={`${s.provider} · ${humanizeStatus(s.status)} · ARS ${s.amountArs} → ${s.destination}`}
                href={`/admin/swaps/${s.id}`}
              />
              <UserField user={s.user} />
              <Field label="Paid" value={formatDateTime(s.paidAt, '')} />
            </React.Fragment>
          ))}
        </Section>
      )}

      {node && <NodeSection node={node} />}

      {!received && !hasPayments && !node && (
        <Section
          icon={<CheckCircle2 className="size-4 text-muted-foreground" />}
          title="No local records"
          description="Nothing on this instance references this invoice."
        >
          {null}
        </Section>
      )}
    </>
  )
}

function NodeSection({
  node
}: {
  node: NonNullable<InvoiceLookupResult['node']>
}) {
  if ('error' in node) {
    return (
      <Section
        icon={<Globe className="size-4 text-muted-foreground" />}
        title="Payee node"
        description={node.error}
      >
        {null}
      </Section>
    )
  }
  return (
    <Section
      icon={
        <span
          className="size-3 rounded-full ring-2 ring-border"
          style={{ backgroundColor: node.color ?? undefined }}
        />
      }
      title={node.alias || 'Payee node'}
      description="External invoice — public data from Amboss."
      badges={
        <a
          href={node.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Amboss <ExternalLink className="size-3" />
        </a>
      }
    >
      <Field
        label="Capacity"
        value={
          node.capacitySats
            ? `${Number(node.capacitySats).toLocaleString()} sats${node.capacityRank ? ` · rank #${node.capacityRank}` : ''}`
            : null
        }
      />
      <Field
        label="Channels"
        value={
          node.channels !== null
            ? `${node.channels}${node.channelsRank ? ` · rank #${node.channelsRank}` : ''}`
            : null
        }
      />
      <Field label="Addresses" value={node.addresses.join(', ') || null} mono />
      <Field label="Last update" value={formatDateTime(node.lastUpdate, '')} />
      <Field label="Website" value={node.socials?.website} />
      <Field label="Twitter" value={node.socials?.twitter} />
      <Field label="Telegram" value={node.socials?.telegram} />
      <Field label="Nostr" value={node.socials?.nostr} mono />
      <Field
        label="Lightning address"
        value={node.socials?.lightning_address}
      />
      <Field label="Message" value={node.socials?.message} />
    </Section>
  )
}

function Section({
  icon,
  title,
  description,
  badges,
  children
}: {
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  badges?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className={ENTER}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {icon}
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="ml-auto flex items-center gap-1.5">{badges}</div>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardHeader>
      {children && (
        <CardContent>
          <dl className="flex flex-col divide-y divide-border">{children}</dl>
        </CardContent>
      )}
    </Card>
  )
}

function Row({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-4">
      <dt className="shrink-0 text-muted-foreground sm:w-40">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-1">{children}</dd>
    </div>
  )
}

/** One label/value row; renders nothing for empty values. */
function Field({
  label,
  value,
  mono,
  copy,
  href
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  copy?: boolean
  href?: string | null
}) {
  if (!value) return null
  const text = (
    <span className={mono ? 'font-mono text-xs break-all' : 'break-words'}>
      {value}
    </span>
  )
  return (
    <Row label={label}>
      {href ? (
        <Link
          href={href}
          className="min-w-0 underline-offset-4 hover:underline"
        >
          {text}
        </Link>
      ) : (
        text
      )}
      {copy && <CopyButton value={value} label={label} />}
    </Row>
  )
}

function UserField({ user }: { user: LookupUser | null }) {
  if (!user) return null
  return (
    <Field
      label="User"
      value={`${user.primaryAddress ?? truncateNpub(user.pubkey)} · ${humanizeStatus(user.role)}`}
      href={`/admin/users/${user.pubkey}`}
    />
  )
}
