'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Nfc,
  Plus,
  Radio,
  Copy,
  ExternalLink,
  Check,
  Ban,
  RefreshCw,
  Ticket,
  Zap,
  AtSign,
  FileText
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/components/admin/auth-context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { DesignImage } from '@/components/admin/design-image'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  buildScanUrl,
  randomUid,
  type TapPC
} from '@/lib/client/card-emulator-crypto'
import { parseDestination } from '@/lib/client/nwc/parse-destination'
import { requestLnurlInvoice } from '@/lib/client/lnurl-invoice'
import { cn } from '@/lib/utils'

interface ApiNtag {
  cid: string
  ctr: number
}
interface ApiCard {
  id: string
  title?: string
  design?: { id: string; description: string | null; imageUrl: string | null } | null
  ntag424?: ApiNtag | null
  pubkey?: string
  username?: string
  otc?: string | null
  remoteWalletId?: string | null
  lastUsedAt?: string | null
}

interface TapStep {
  label: string
  status: number
  ok: boolean
  body: unknown
}

type DestKind = 'address' | 'invoice'
type Verdict = { kind: 'ok' | 'error'; title: string; text: string }

export function CardEmulator() {
  const { apiClient } = useAuth()
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const [cards, setCards] = useState<ApiCard[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [selectedId, setSelectedId] = useState<string>('')
  const [creating, setCreating] = useState(false)

  // Payment destination — the invoice the card's wallet is asked to pay.
  const [destKind, setDestKind] = useState<DestKind>('address')
  const [address, setAddress] = useState('')
  const [amount, setAmount] = useState('21')
  const [invoice, setInvoice] = useState('')

  const [emulatedCtr, setEmulatedCtr] = useState(0)
  const [paying, setPaying] = useState(false)
  const [steps, setSteps] = useState<TapStep[]>([])
  const [verdict, setVerdict] = useState<Verdict | null>(null)

  const [activationUrl, setActivationUrl] = useState<string | null>(null)
  const [minting, setMinting] = useState(false)

  const selected = useMemo(
    () => cards.find(c => c.id === selectedId) ?? null,
    [cards, selectedId]
  )

  const loadCards = useCallback(async () => {
    setLoadingCards(true)
    try {
      const data = await apiClient.get<ApiCard[]>('/api/cards')
      setCards(data)
      return data
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load cards')
      return []
    } finally {
      setLoadingCards(false)
    }
  }, [apiClient])

  useEffect(() => {
    loadCards()
  }, [loadCards])

  // Reset tap state when switching cards; seed the emulated counter from the
  // card's real server-side counter.
  useEffect(() => {
    setSteps([])
    setVerdict(null)
    setActivationUrl(null)
    setEmulatedCtr(selected?.ntag424?.ctr ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  async function handleCreateFake() {
    setCreating(true)
    try {
      const designs = await apiClient.get<
        { id: string; archivedAt?: string | null }[]
      >('/api/card-designs/list')
      const design = designs.find(d => !d.archivedAt) ?? designs[0]
      if (!design) {
        toast.error('Create a card design first')
        return
      }
      const uid = randomUid()
      const card = await apiClient.post<ApiCard>('/api/cards', {
        id: uid,
        designId: design.id
      })
      await loadCards()
      setSelectedId(card.id)
      toast.success(`Fake card created — UID ${uid}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create card')
    } finally {
      setCreating(false)
    }
  }

  /**
   * Resolve the payment destination to a bolt11 the card's wallet will pay:
   * either the pasted invoice, or an invoice freshly minted from a Lightning
   * address + amount via LUD-16.
   */
  async function resolveInvoice(): Promise<string> {
    if (destKind === 'invoice') {
      const parsed = parseDestination(invoice)
      if (parsed.kind !== 'invoice') {
        throw new Error('Paste a bolt11 invoice (lnbc…)')
      }
      return parsed.bolt11
    }
    const parsed = parseDestination(address)
    if (parsed.kind !== 'lnurl-pay') {
      throw new Error('Enter a Lightning address (name@host)')
    }
    const sats = Number(amount)
    if (!Number.isFinite(sats) || sats <= 0) {
      throw new Error('Enter an amount in sats')
    }
    return requestLnurlInvoice(parsed.lnurlpUrl, sats, 'Card emulator tap')
  }

  /**
   * Full tap: sign a SUN server-side (keys never reach the browser), hit the
   * live LNURL-withdraw `/scan`, then follow its callback with the resolved
   * invoice so the card's wallet actually pays it — identical to a physical tap.
   */
  async function handleTapAndPay() {
    if (!selected?.ntag424) return
    setPaying(true)
    setVerdict(null)
    const collected: TapStep[] = []
    try {
      // 1. Resolve the invoice first so a bad destination fails before tapping
      //    (which would otherwise waste a counter increment).
      const bolt11 = await resolveInvoice()

      // 2. Sign the tap.
      const tap = await apiClient.post<{ p: string; c: string; ctr: number }>(
        `/api/cards/${selected.id}/emulate-tap`,
        {}
      )
      setEmulatedCtr(tap.ctr)
      const pc: TapPC = { p: tap.p, c: tap.c }

      // 3. GET /scan — the LNURL-withdraw request.
      const scanUrl = buildScanUrl(origin, selected.id, pc)
      const scanRes = await fetch(scanUrl)
      const scanBody = await scanRes.json().catch(() => null)
      collected.push({
        label: 'GET /scan — LNURL-withdraw request',
        status: scanRes.status,
        ok: scanRes.ok,
        body: scanBody
      })
      setSteps([...collected])

      const cbUrl =
        scanBody && typeof scanBody.callback === 'string' ? scanBody.callback : null
      if (!scanRes.ok || !cbUrl) {
        setVerdict({
          kind: 'error',
          title: 'Invalid scan',
          text: scanBody?.error?.message ?? `Scan failed (HTTP ${scanRes.status})`
        })
        toast.error('Invalid scan')
        await loadCards()
        return
      }

      // 4. GET /scan/cb with the real invoice → card's wallet pays.
      const payUrl = `${cbUrl}&pr=${encodeURIComponent(bolt11)}`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30000)
      let cbRes: Response
      let cbBody: { error?: { message?: string } } | null
      try {
        cbRes = await fetch(payUrl, { signal: controller.signal })
        cbBody = await cbRes.json().catch(() => null)
      } finally {
        clearTimeout(timer)
      }
      collected.push({
        label: 'GET /scan/cb — verify SUN + pay invoice',
        status: cbRes.status,
        ok: cbRes.ok,
        body: cbBody
      })
      setSteps([...collected])

      const message = cbBody?.error?.message
      if (cbRes.ok) {
        setVerdict({
          kind: 'ok',
          title: 'Payment sent',
          text: "The card's wallet paid the invoice."
        })
        toast.success('Payment sent')
      } else if (cbRes.status >= 500) {
        // SUN was valid (counter advanced) but the wallet couldn't pay.
        setVerdict({
          kind: 'error',
          title: 'Payment failed',
          text: message ?? `Wallet couldn't pay the invoice (HTTP ${cbRes.status})`
        })
        toast.error(message ?? 'Payment failed')
      } else {
        // 4xx — the scan itself was rejected (e.g. card not configured).
        setVerdict({
          kind: 'error',
          title: 'Scan rejected',
          text: message ?? `Rejected (HTTP ${cbRes.status})`
        })
        toast.error(message ?? 'Scan rejected')
      }
      await loadCards()
    } catch (err) {
      const text =
        err instanceof Error && err.name === 'AbortError'
          ? 'Wallet unreachable — request timed out'
          : err instanceof Error
            ? err.message
            : 'Tap failed'
      setVerdict({ kind: 'error', title: 'Failed', text })
      toast.error(text)
    } finally {
      setPaying(false)
    }
  }

  async function handleMintActivation() {
    if (!selected) return
    setMinting(true)
    try {
      const res = await apiClient.post<{ qrPayload: string }>(
        `/api/cards/${selected.id}/activation-tokens`,
        { qrKind: 'ONE_TIME' }
      )
      setActivationUrl(res.qrPayload)
      toast.success('Activation URL minted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mint token')
    } finally {
      setMinting(false)
    }
  }

  const usableSelected = !!selected?.ntag424
  const payDisabled =
    paying ||
    !usableSelected ||
    (destKind === 'invoice' ? !invoice.trim() : !address.trim() || !(Number(amount) > 0))

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Nfc className="size-5" />
          <h1 className="text-xl font-semibold">Card Emulator</h1>
          <Badge variant="secondary" className="ml-1">
            dev tool
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Impersonate a BoltCard tap end-to-end: the server signs the NTAG424 SUN
          (keys never leave it), the emulator hits the live scan endpoint, and the
          card&apos;s wallet pays a real invoice. Admin-only.
        </p>
      </header>

      {/* Card picker */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Card to emulate</Label>
            <Select
              value={selectedId}
              onValueChange={setSelectedId}
              disabled={loadingCards}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={loadingCards ? 'Loading…' : 'Select a card'}
                />
              </SelectTrigger>
              <SelectContent>
                {cards.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {(c.title || 'Card') +
                      ' · ' +
                      (c.ntag424?.cid ?? '????') +
                      ' · ' +
                      shortId(c.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={loadCards}
              disabled={loadingCards}
              title="Reload cards"
            >
              <RefreshCw className={cn('size-4', loadingCards && 'animate-spin')} />
            </Button>
            <Button variant="secondary" onClick={handleCreateFake} disabled={creating}>
              {creating ? <Spinner size={16} /> : <Plus className="size-4" />}
              Create fake card
            </Button>
          </div>
        </div>

        {selected && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
            <Badge variant={selected.pubkey ? 'default' : 'secondary'}>
              {selected.pubkey ? 'Paired' : 'Unpaired'}
            </Badge>
            <Badge variant={selected.lastUsedAt ? 'default' : 'outline'}>
              {selected.lastUsedAt ? 'Used' : 'Never tapped'}
            </Badge>
            <Badge variant="outline" className="font-mono">
              ctr {emulatedCtr}
            </Badge>
            {!usableSelected && (
              <span className="text-xs text-destructive">No NTAG424 — can&apos;t emulate</span>
            )}
          </div>
        )}
      </section>

      {selected && (
        <Tabs defaultValue="pay">
          <TabsList className="w-full justify-start sm:w-auto">
            <TabsTrigger value="pay">
              <Zap className="mr-1.5 size-4" /> Pay
            </TabsTrigger>
            <TabsTrigger value="card">
              <Nfc className="mr-1.5 size-4" /> Card
            </TabsTrigger>
            <TabsTrigger value="activation">
              <Ticket className="mr-1.5 size-4" /> Activation
            </TabsTrigger>
          </TabsList>

          {/* ── Pay tab ─────────────────────────────────────────────── */}
          <TabsContent value="pay" className="space-y-4">
            <section
              className={cn(
                'space-y-4 rounded-xl border border-border bg-card p-4',
                !usableSelected && 'pointer-events-none opacity-50'
              )}
            >
              <div className="space-y-1">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Radio className="size-4" /> Tap &amp; pay
                </h2>
                <p className="text-xs text-muted-foreground">
                  Choose what the card pays, then tap. The card&apos;s wallet settles
                  the invoice over its NWC connection.
                </p>
              </div>

              <Tabs
                value={destKind}
                onValueChange={v => setDestKind(v as DestKind)}
              >
                <TabsList>
                  <TabsTrigger value="address">
                    <AtSign className="mr-1.5 size-3.5" /> Lightning address
                  </TabsTrigger>
                  <TabsTrigger value="invoice">
                    <FileText className="mr-1.5 size-3.5" /> Invoice
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="address" className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="emu-address">Lightning address</Label>
                    <Input
                      id="emu-address"
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      placeholder="satoshi@example.com"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="emu-amount">Amount (sats)</Label>
                    <Input
                      id="emu-amount"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="21"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="invoice" className="space-y-1.5">
                  <Label htmlFor="emu-invoice">bolt11 invoice</Label>
                  <Textarea
                    id="emu-invoice"
                    value={invoice}
                    onChange={e => setInvoice(e.target.value)}
                    placeholder="lnbc…"
                    rows={3}
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                  <p className="text-2xs text-muted-foreground">
                    The amount is taken from the invoice.
                  </p>
                </TabsContent>
              </Tabs>

              <Button onClick={handleTapAndPay} disabled={payDisabled} className="w-full">
                {paying ? <Spinner size={16} /> : <Radio className="size-4" />}
                {paying ? 'Tapping…' : 'Tap card & pay'}
              </Button>

              {verdict && (
                <div
                  className={cn(
                    'flex items-start gap-2 rounded-lg border p-3 text-sm',
                    verdict.kind === 'ok'
                      ? 'border-green-500/40 bg-green-500/10 text-foreground'
                      : 'border-destructive/40 bg-destructive/10 text-destructive'
                  )}
                >
                  {verdict.kind === 'ok' ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-green-500" />
                  ) : (
                    <Ban className="mt-0.5 size-4 shrink-0" />
                  )}
                  <div>
                    <p className="font-medium">{verdict.title}</p>
                    <p
                      className={cn(
                        'text-xs',
                        verdict.kind === 'error' && 'text-destructive/90'
                      )}
                    >
                      {verdict.text}
                    </p>
                  </div>
                </div>
              )}

              {steps.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Request log
                  </p>
                  {steps.map((s, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-background p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{s.label}</span>
                        <Badge variant={s.ok ? 'default' : 'destructive'}>
                          {s.status}
                        </Badge>
                      </div>
                      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-2xs leading-relaxed text-muted-foreground">
                        {JSON.stringify(s.body, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </TabsContent>

          {/* ── Card tab ────────────────────────────────────────────── */}
          <TabsContent value="card">
            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Card status</h2>
              <div className="flex flex-col gap-4 sm:flex-row">
                <DesignImage
                  src={selected.design?.imageUrl ?? null}
                  alt={selected.design?.description ?? 'Card design'}
                  className="w-full shrink-0 sm:w-48"
                />
                <dl className="grid flex-1 grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <Field label="Card ID" value={selected.id} mono />
                  <Field label="UID (cid)" value={selected.ntag424?.cid ?? '—'} mono />
                  <Field
                    label="Server counter"
                    value={String(selected.ntag424?.ctr ?? '—')}
                  />
                  <Field
                    label="Design"
                    value={selected.design?.description ?? '—'}
                    href={
                      selected.design?.id
                        ? `/admin/card-designs/${selected.design.id}`
                        : undefined
                    }
                  />
                  <Field
                    label="Owner"
                    value={selected.username || selected.pubkey || 'Not paired'}
                    mono={!!selected.pubkey}
                  />
                  <Field
                    label="Wallet binding"
                    value={
                      selected.remoteWalletId
                        ? shortId(selected.remoteWalletId)
                        : 'Default / unbound'
                    }
                  />
                  <Field
                    label="Last used"
                    value={
                      selected.lastUsedAt
                        ? new Date(selected.lastUsedAt).toLocaleString()
                        : '—'
                    }
                  />
                  <Field
                    label="OTC"
                    value={selected.otc ? shortId(selected.otc) : '—'}
                    mono={!!selected.otc}
                  />
                </dl>
              </div>
            </section>
          </TabsContent>

          {/* ── Activation tab ──────────────────────────────────────── */}
          <TabsContent value="activation">
            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Ticket className="size-4" /> Activation
              </h2>
              <p className="text-xs text-muted-foreground">
                Mint a one-time activation URL for this card and open it in another
                tab to exercise the wallet activation flow.
              </p>
              <Button
                variant="secondary"
                onClick={handleMintActivation}
                disabled={minting}
              >
                {minting ? <Spinner size={16} /> : <Ticket className="size-4" />}
                Mint activation URL
              </Button>
              {activationUrl && (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-background p-3">
                  <a
                    href={activationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 break-all text-xs text-foreground underline-offset-2 hover:underline"
                  >
                    {activationUrl}
                  </a>
                  <CopyBtn value={activationUrl} />
                  <a
                    href={activationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    title="Open in a new tab"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
      )}

      <p className="text-2xs text-muted-foreground">
        Taps are signed server-side via{' '}
        <code>/api/cards/[id]/emulate-tap</code> (keys never reach the browser)
        and verified by the real <code>/api/cards/[id]/scan/cb</code> endpoint —
        identical math to a physical NTAG424 tag.
      </p>
    </div>
  )
}

function Field({
  label,
  value,
  mono,
  href
}: {
  label: string
  value: string
  mono?: boolean
  href?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={cn('truncate text-sm', mono && 'font-mono text-xs')}>
        {href ? (
          <Link href={href} className="text-primary hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.error('Copy failed')
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
  )
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id
}
