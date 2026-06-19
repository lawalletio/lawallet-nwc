'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Nfc,
  Plus,
  Radio,
  Copy,
  ExternalLink,
  Check,
  Ban,
  RefreshCw,
  Ticket
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/components/admin/auth-context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Separator } from '@/components/ui/separator'
import { DesignImage } from '@/components/admin/design-image'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  buildScanUrl,
  randomUid,
  type TapPC
} from '@/lib/client/card-emulator-crypto'
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

export function CardEmulator() {
  const { apiClient } = useAuth()
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const [cards, setCards] = useState<ApiCard[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [selectedId, setSelectedId] = useState<string>('')
  const [creating, setCreating] = useState(false)

  const [emulatedCtr, setEmulatedCtr] = useState(0)
  const [pc, setPc] = useState<TapPC | null>(null)
  const [scanUrl, setScanUrl] = useState<string | null>(null)
  const [tapping, setTapping] = useState(false)
  const [steps, setSteps] = useState<TapStep[]>([])
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(
    null
  )

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

  // Reset emulator state only when the user switches to a different card, and
  // seed the emulated counter from that card's real server-side counter.
  // Deliberately keyed on `selectedId` alone: a tap refreshes the card's `ctr`
  // via loadCards(), and we must NOT wipe the just-rendered tap result then.
  useEffect(() => {
    setPc(null)
    setScanUrl(null)
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

  async function handleCreateTap() {
    if (!selected?.ntag424) return
    try {
      // Signing happens server-side so the card's keys never reach the browser.
      const res = await apiClient.post<{ p: string; c: string; ctr: number }>(
        `/api/cards/${selected.id}/emulate-tap`,
        {}
      )
      const next_pc: TapPC = { p: res.p, c: res.c }
      setEmulatedCtr(res.ctr)
      setPc(next_pc)
      setScanUrl(buildScanUrl(origin, selected.id, next_pc))
      setSteps([])
      setVerdict(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sign tap')
    }
  }

  // Fetch the scan URL like a wallet would, then follow the LUD-03 callback
  // with the real `pay` action and a placeholder invoice. The server verifies
  // the SUN (advancing the counter) and then resolves a wallet to spend from —
  // an UNPAIRED card has none, so it rejects the scan with "Card is not
  // configured for payments". That's the invalid-scan path we want to surface.
  async function handleTap() {
    if (!scanUrl || !selected) return
    setTapping(true)
    setVerdict(null)
    const collected: TapStep[] = []
    try {
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
        scanBody && typeof scanBody.callback === 'string'
          ? scanBody.callback
          : null
      if (cbUrl) {
        // A placeholder bolt11 satisfies the `pr` requirement so the request
        // reaches wallet resolution. Time-box it: a paired card with a real
        // wallet would actually attempt the (doomed) payment.
        const payUrl = `${cbUrl}&pr=lnbc1p0emulatedtap`
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 20000)
        let cbRes: Response
        let cbBody: { error?: { message?: string } } | null
        try {
          cbRes = await fetch(payUrl, { signal: controller.signal })
          cbBody = await cbRes.json().catch(() => null)
        } finally {
          clearTimeout(timer)
        }
        collected.push({
          label: 'GET /scan/cb — verify SUN + route payment',
          status: cbRes.status,
          ok: cbRes.ok,
          body: cbBody
        })
        setSteps([...collected])

        const message = cbBody?.error?.message
        if (cbRes.ok) {
          setVerdict({ ok: true, text: 'Payment accepted' })
          toast.success('Tap paid')
        } else {
          setVerdict({
            ok: false,
            text: message ?? `Scan rejected (HTTP ${cbRes.status})`
          })
          toast.error(message ?? 'Scan rejected')
        }
        // The counter advances whenever the SUN is valid, even if the payment
        // is then declined — refresh so the status panel reflects that.
        await loadCards()
      }
    } catch (err) {
      const text =
        err instanceof Error && err.name === 'AbortError'
          ? 'Wallet unreachable — request timed out'
          : err instanceof Error
            ? err.message
            : 'Tap request failed'
      setVerdict({ ok: false, text })
      toast.error(text)
    } finally {
      setTapping(false)
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
          Impersonate a BoltCard: the server signs an NTAG424 SUN tap (the keys
          never leave it) and the emulator hits the live scan endpoint with the
          result. Admin-only.
        </p>
      </header>

      {/* Card picker */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Card to emulate
            </label>
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
            <Button
              variant="secondary"
              onClick={handleCreateFake}
              disabled={creating}
            >
              {creating ? <Spinner size={16} /> : <Plus className="size-4" />}
              Create fake card
            </Button>
          </div>
        </div>
      </section>

      {selected && (
        <>
          {/* Status + data */}
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Card status</h2>
              <div className="flex gap-1.5">
                <Badge variant={selected.pubkey ? 'default' : 'secondary'}>
                  {selected.pubkey ? 'Paired' : 'Unpaired'}
                </Badge>
                <Badge variant={selected.lastUsedAt ? 'default' : 'outline'}>
                  {selected.lastUsedAt ? 'Used' : 'Never tapped'}
                </Badge>
              </div>
            </div>
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
              <Field label="Design" value={selected.design?.description ?? '—'} />
              <Field
                label="Owner"
                value={selected.username || selected.pubkey || 'Not paired'}
                mono={!!selected.pubkey}
              />
              <Field
                label="Wallet binding"
                value={selected.remoteWalletId ? shortId(selected.remoteWalletId) : 'Default / unbound'}
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

            {!usableSelected && (
              <p className="text-xs text-destructive">
                This card has no NTAG424 chip — it can&apos;t be emulated.
              </p>
            )}
          </section>

          {/* Tap */}
          <section
            className={cn(
              'space-y-3 rounded-xl border border-border bg-card p-4',
              !usableSelected && 'pointer-events-none opacity-50'
            )}
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Radio className="size-4" /> Tap
              </h2>
              <span className="text-xs text-muted-foreground">
                Emulated counter:{' '}
                <span className="font-mono text-foreground">{emulatedCtr}</span>
              </span>
            </div>

            <Button onClick={handleCreateTap} disabled={!usableSelected}>
              <Radio className="size-4" />
              Create tap
            </Button>

            {scanUrl && (
              <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Signed tap URL (counter {emulatedCtr})
                </p>
                <div className="flex items-start gap-2">
                  <code className="flex-1 break-all text-xs text-foreground">
                    {scanUrl}
                  </code>
                  <CopyBtn value={scanUrl} />
                  <a
                    href={scanUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    title="Open raw response in a new tab"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </div>
                {pc && (
                  <div className="grid grid-cols-1 gap-1 pt-1 sm:grid-cols-2">
                    <Field label="p" value={pc.p} mono />
                    <Field label="c" value={pc.c} mono />
                  </div>
                )}
                <Button
                  size="sm"
                  onClick={handleTap}
                  disabled={tapping}
                  className="mt-1"
                >
                  {tapping ? <Spinner size={16} /> : <Radio className="size-4" />}
                  Tap card &amp; fetch result
                </Button>
              </div>
            )}

            {verdict && (
              <div
                className={cn(
                  'flex items-start gap-2 rounded-lg border p-3 text-sm',
                  verdict.ok
                    ? 'border-lw-teal/40 bg-lw-teal/10 text-foreground'
                    : 'border-destructive/40 bg-destructive/10 text-destructive'
                )}
              >
                {verdict.ok ? (
                  <Check className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <Ban className="mt-0.5 size-4 shrink-0" />
                )}
                <div>
                  <p className="font-medium">
                    {verdict.ok ? 'Scan accepted' : 'Invalid scan'}
                  </p>
                  <p className={cn('text-xs', !verdict.ok && 'text-destructive/90')}>
                    {verdict.text}
                  </p>
                </div>
              </div>
            )}

            {steps.length > 0 && (
              <div className="space-y-2">
                {steps.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border bg-background p-3"
                  >
                    <div className="flex items-center justify-between">
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

          {/* Activation */}
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
        </>
      )}

      <Separator />
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
  mono
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={cn('truncate text-sm', mono && 'font-mono text-xs')}>
        {value}
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
