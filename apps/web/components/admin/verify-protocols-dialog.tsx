'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  RadioTower,
  ScanSearch,
  XCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/components/admin/auth-context'
import { ProtocolChip } from '@/components/wallet/shared/protocol-chip'
import { ProtocolChips } from '@/components/wallet/shared/protocol-chips'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import type {
  AddressData,
  VerifyAddressProtocolsResult
} from '@/lib/client/hooks/use-addresses'
import {
  summarizeProtocolScan,
  type ProtocolChange
} from '@/lib/protocols/diff'
import { PROTOCOL_REFERENCE, type ProtocolKey } from '@/lib/protocols/reference'
import { cn } from '@/lib/utils'

type Phase = 'idle' | 'loading' | 'running' | 'done' | 'empty' | 'failed'

/** Matches the address-detail chip order so the scan reads the same way. */
const SCAN_ORDER: ProtocolKey[] = ['lud16', 'nip05', 'lud12', 'lud21', 'nip57']

const EMPTY_PROTOCOLS: VerifyAddressProtocolsResult['protocols']['protocols'] =
  {
    lud16: null,
    nip05: null,
    lud21: null,
    nip57: null,
    lud12: null
  }

function unknownEnvelope(
  reason: string | null
): VerifyAddressProtocolsResult['protocols'] {
  return {
    protocols: EMPTY_PROTOCOLS,
    source: 'unavailable',
    reason,
    provider: null
  }
}

function failedResult(
  username: string,
  message: string
): VerifyAddressProtocolsResult {
  const envelope = unknownEnvelope(message)
  return {
    username,
    mode: 'IDLE',
    redirect: null,
    probed: false,
    persisted: false,
    error: message,
    previous: envelope,
    protocols: envelope
  }
}

export function VerifyProtocolsDialog({
  open,
  onOpenChange,
  domain,
  onComplete
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  domain: string
  onComplete?: () => void
}) {
  const { apiClient } = useAuth()
  const apiClientRef = useRef(apiClient)
  apiClientRef.current = apiClient
  const cancelledRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const [phase, setPhase] = useState<Phase>('idle')
  const [queue, setQueue] = useState<string[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [currentProtocols, setCurrentProtocols] =
    useState<VerifyAddressProtocolsResult['protocols']['protocols']>(
      EMPTY_PROTOCOLS
    )
  const [results, setResults] = useState<VerifyAddressProtocolsResult[]>([])
  const [startError, setStartError] = useState<string | null>(null)

  const total = queue.length
  const completed = results.length
  const remaining = Math.max(total - completed - (current ? 1 : 0), 0)
  const failed = results.filter(result => result.error).length
  const probed = results.filter(result => result.probed).length
  const progressValue = total === 0 ? 0 : Math.round((completed / total) * 100)
  const running = phase === 'loading' || phase === 'running'
  const summary = phase === 'done' ? summarizeProtocolScan(results) : null

  useEffect(() => {
    if (!open) {
      cancelledRef.current = true
      return
    }

    cancelledRef.current = false
    setPhase('loading')
    setQueue([])
    setCurrent(null)
    setCurrentProtocols(EMPTY_PROTOCOLS)
    setResults([])
    setStartError(null)

    async function run() {
      try {
        const addresses = await apiClientRef.current.get<AddressData[]>(
          '/api/lightning-addresses'
        )
        if (cancelledRef.current) {
          setPhase('done')
          return
        }

        const usernames = addresses.map(address => address.username)
        setQueue(usernames)
        if (usernames.length === 0) {
          setPhase('empty')
          return
        }

        setPhase('running')
        const collected: VerifyAddressProtocolsResult[] = []

        for (const username of usernames) {
          if (cancelledRef.current) break
          setCurrent(username)
          setCurrentProtocols(EMPTY_PROTOCOLS)

          let result: VerifyAddressProtocolsResult
          try {
            result =
              await apiClientRef.current.post<VerifyAddressProtocolsResult>(
                '/api/lightning-addresses/verify-protocols',
                { username }
              )
          } catch (err) {
            result = failedResult(
              username,
              err instanceof Error ? err.message : 'Verification failed'
            )
          }

          if (cancelledRef.current) break
          setCurrentProtocols(result.protocols.protocols)
          collected.push(result)
          setResults([...collected])
        }

        setCurrent(null)
        setPhase('done')
        onCompleteRef.current?.()
        if (cancelledRef.current) {
          toast.message('Protocol verification stopped')
          return
        }
        const report = summarizeProtocolScan(collected)
        toast.success(
          report.fixed > 0
            ? `Verified ${collected.length} addresses · ${report.fixed} fixed`
            : report.failed > 0
              ? `Verified ${collected.length} addresses (${report.failed} with errors)`
              : `Verified ${collected.length} addresses`
        )
      } catch (err) {
        if (cancelledRef.current) {
          setPhase('done')
          return
        }
        const message =
          err instanceof Error ? err.message : 'Could not load addresses'
        setStartError(message)
        setPhase('failed')
        toast.error(message)
      }
    }

    void run()

    return () => {
      cancelledRef.current = true
    }
  }, [open])

  function handleOpenChange(next: boolean) {
    if (!next && running) {
      cancelledRef.current = true
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="overflow-hidden sm:max-w-xl"
        onPointerDownOutside={event => {
          if (running) event.preventDefault()
        }}
        onEscapeKeyDown={event => {
          if (running) event.preventDefault()
        }}
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground ring-1 ring-border">
              {running ? (
                <RadioTower className="size-5 animate-pulse" aria-hidden />
              ) : (
                <ScanSearch className="size-5" aria-hidden />
              )}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle>Verify Protocols</DialogTitle>
              <DialogDescription>
                Re-check LUD-16, NIP-05, LUD-12, LUD-21 and NIP-57 for every
                lightning address. Alias targets are probed over the network.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {summary ? (
            <div
              className="grid grid-cols-4 overflow-hidden rounded-lg border border-border bg-muted/30"
              aria-live="polite"
            >
              <StatCell label="Scanned" value={summary.scanned} />
              <StatCell
                label="Fixed"
                value={summary.fixed}
                emphasize={summary.fixed > 0}
              />
              <StatCell label="Changed" value={summary.changed} />
              <StatCell
                label="Failed"
                value={summary.failed}
                warn={summary.failed > 0}
              />
            </div>
          ) : (
            <div
              className="grid grid-cols-3 overflow-hidden rounded-lg border border-border bg-muted/30"
              aria-live="polite"
            >
              <StatCell label="Scanned" value={completed} />
              <StatCell label="Probed" value={probed} />
              <StatCell label="Failed" value={failed} warn={failed > 0} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 font-mono text-xs tabular-nums text-muted-foreground">
              <span>
                {phase === 'loading'
                  ? 'Loading addresses…'
                  : phase === 'empty'
                    ? 'No addresses to verify'
                    : `${completed} / ${total || '—'}`}
              </span>
              <span>
                {running
                  ? `${progressValue}%`
                  : phase === 'done'
                    ? 'Done'
                    : null}
              </span>
            </div>
            <div className="relative">
              <Progress
                value={phase === 'loading' ? 18 : progressValue}
                aria-label="Protocol verification progress"
                className={cn(
                  'h-2',
                  phase === 'loading' && '[&>div]:animate-pulse'
                )}
              />
              {running ? (
                <span
                  className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
                  aria-hidden
                >
                  <span className="absolute inset-y-0 w-1/3 animate-[shimmer_1.4s_linear_infinite] bg-gradient-to-r from-transparent via-primary-foreground/40 to-transparent" />
                </span>
              ) : null}
            </div>
          </div>

          {summary ? (
            <ProtocolReport
              summary={summary}
              domain={domain}
              failures={results.filter(result => result.error)}
            />
          ) : (
            <>
              <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4">
                <div
                  className="pointer-events-none absolute inset-0 opacity-[0.07]"
                  aria-hidden
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--foreground)) 1px, transparent 1px)',
                    backgroundSize: '18px 18px'
                  }}
                />
                <div className="relative flex flex-col gap-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {current ? 'Now scanning' : 'Waiting'}
                  </p>
                  <p className="truncate font-mono text-lg font-semibold tracking-tight">
                    {current
                      ? `${current}@${domain}`
                      : phase === 'loading'
                        ? 'Fetching address list…'
                        : '—'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SCAN_ORDER.map(key => (
                      <ProtocolChip
                        key={key}
                        protocolKey={key}
                        state={current ? currentProtocols[key] : null}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {results.length > 0 ? (
                <ScrollArea className="h-40 rounded-lg border border-border">
                  <ol className="flex flex-col">
                    {[...results].reverse().map(result => (
                      <li
                        key={result.username}
                        className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
                      >
                        {result.error ? (
                          <XCircle
                            className="size-3.5 shrink-0 text-destructive"
                            aria-label="Failed"
                          />
                        ) : (
                          <CheckCircle2
                            className="size-3.5 shrink-0 text-emerald-500"
                            aria-label="Verified"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {result.username}@{domain}
                        </span>
                        <ProtocolChips
                          protocols={result.protocols.protocols}
                          className="hidden sm:flex"
                        />
                      </li>
                    ))}
                  </ol>
                </ScrollArea>
              ) : null}
            </>
          )}

          {phase === 'failed' && startError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>{startError}</p>
            </div>
          ) : null}

          {phase === 'running' && remaining > 0 ? (
            <p className="text-xs text-muted-foreground">
              {remaining} remaining
              {current ? ` · probing ${current}` : ''}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {running ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                cancelledRef.current = true
              }}
            >
              <Spinner size={16} data-icon="inline-start" />
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              variant="theme"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProtocolReport({
  summary,
  domain,
  failures
}: {
  summary: ReturnType<typeof summarizeProtocolScan>
  domain: string
  failures: VerifyAddressProtocolsResult[]
}) {
  const ledger = SCAN_ORDER.filter(key => {
    const tally = summary.byProtocol[key]
    return tally.newlyValid + tally.newlyKnown + tally.lost > 0
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          aria-hidden
          style={{
            backgroundImage:
              'linear-gradient(to right, hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--foreground)) 1px, transparent 1px)',
            backgroundSize: '18px 18px'
          }}
        />
        <div className="relative flex flex-col gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Protocol changes
          </p>
          {ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No protocol values changed
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {ledger.map(key => {
                const tally = summary.byProtocol[key]
                return (
                  <li
                    key={key}
                    className="flex items-baseline justify-between gap-3 font-mono text-xs"
                  >
                    <span className="font-medium tracking-tight">
                      {PROTOCOL_REFERENCE[key].label}
                    </span>
                    <span className="flex flex-wrap justify-end gap-2 tabular-nums text-muted-foreground">
                      {tally.newlyValid > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          +{tally.newlyValid} valid
                        </span>
                      ) : null}
                      {tally.newlyKnown > 0 ? (
                        <span>+{tally.newlyKnown} checked</span>
                      ) : null}
                      {tally.lost > 0 ? (
                        <span className="text-destructive">
                          −{tally.lost} lost
                        </span>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {summary.changedAddresses.length > 0 || failures.length > 0 ? (
        <ScrollArea className="h-48 rounded-lg border border-border">
          <ol className="flex flex-col">
            {summary.fixedAddresses.map(outcome => (
              <li
                key={`fixed-${outcome.username}`}
                className="flex flex-col gap-1.5 border-b border-border/60 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2
                    className="size-3.5 shrink-0 text-emerald-500"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {outcome.username}@{domain}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    Fixed
                  </Badge>
                </div>
                <ChangeList changes={outcome.changes} />
              </li>
            ))}
            {summary.changedAddresses
              .filter(outcome => !outcome.fixed)
              .map(outcome => (
                <li
                  key={`changed-${outcome.username}`}
                  className="flex flex-col gap-1.5 border-b border-border/60 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <ArrowRight
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {outcome.username}@{domain}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      Changed
                    </Badge>
                  </div>
                  <ChangeList changes={outcome.changes} />
                </li>
              ))}
            {failures.map(result => (
              <li
                key={`failed-${result.username}`}
                className="flex items-start gap-2 border-b border-border/60 px-3 py-2.5 last:border-b-0"
              >
                <XCircle
                  className="mt-0.5 size-3.5 shrink-0 text-destructive"
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-mono text-xs">
                    {result.username}@{domain}
                  </span>
                  {result.error ? (
                    <span className="text-[11px] text-destructive">
                      {result.error}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </ScrollArea>
      ) : null}
    </div>
  )
}

function ChangeList({ changes }: { changes: ProtocolChange[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 pl-5">
      {changes.map(change => (
        <span
          key={change.key}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground"
        >
          <span className="font-medium text-foreground/80">
            {PROTOCOL_REFERENCE[change.key].label}
          </span>
          <StateMark value={change.from} />
          <ArrowRight className="size-2.5" aria-hidden />
          <StateMark value={change.to} />
        </span>
      ))}
    </div>
  )
}

function StateMark({ value }: { value: boolean | null }) {
  if (value === true) {
    return (
      <span className="text-emerald-600 dark:text-emerald-400" aria-label="on">
        ✓
      </span>
    )
  }
  if (value === false) {
    return <span aria-label="off">−</span>
  }
  return <span aria-label="unknown">?</span>
}

function StatCell({
  label,
  value,
  warn = false,
  emphasize = false
}: {
  label: string
  value: number
  warn?: boolean
  emphasize?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2.5 text-center">
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'font-mono text-lg font-semibold tabular-nums',
          warn && 'text-destructive',
          emphasize && 'text-emerald-600 dark:text-emerald-400'
        )}
      >
        {value}
      </span>
    </div>
  )
}
