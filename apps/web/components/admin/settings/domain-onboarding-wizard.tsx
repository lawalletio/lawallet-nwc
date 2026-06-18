'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Globe2,
  LockKeyhole,
  RefreshCw,
  Route,
  Search,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import type { DomainProbeResult, InstructionProfile, ProbeCheck } from '@/lib/domain-onboarding'
import { useAuth } from '@/components/admin/auth-context'
import { invalidateApiPath } from '@/lib/client/hooks/use-api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i
const WORDPRESS_PLUGIN_URL = 'https://wordpress.lawallet.io'

type WizardStep = 'input' | 'checking' | 'result'

interface ProbeRunOptions {
  preserveVisibleResult?: boolean
}

interface DomainOnboardingWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDomain: string
  initialEndpoint: string
  currentOrigin: string
  latestProbeResult?: DomainProbeResult | null
  latestProbeError?: string | null
  latestProbeChecking?: boolean
  onConfigured: (values: { domain: string; endpoint: string }) => void
  updateSettings: (data: Record<string, string>) => Promise<unknown>
}

interface ActiveProbe {
  domain: string
  endpoint: string
  startedAt: number
}

const ACTIVE_PROBE_STORAGE_KEY = 'lawallet-domain-wizard-active-probe'
const ACTIVE_PROBE_RESULT_STORAGE_KEY = 'lawallet-domain-wizard-active-probe-result'
const ACTIVE_PROBE_TTL_MS = 2 * 60 * 1000

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '').toLowerCase()
}

function readActiveProbe(): ActiveProbe | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_PROBE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ActiveProbe>
    if (
      typeof parsed.domain !== 'string' ||
      typeof parsed.endpoint !== 'string' ||
      typeof parsed.startedAt !== 'number' ||
      Date.now() - parsed.startedAt > ACTIVE_PROBE_TTL_MS
    ) {
      window.sessionStorage.removeItem(ACTIVE_PROBE_STORAGE_KEY)
      return null
    }
    return {
      domain: parsed.domain,
      endpoint: parsed.endpoint,
      startedAt: parsed.startedAt,
    }
  } catch {
    window.sessionStorage.removeItem(ACTIVE_PROBE_STORAGE_KEY)
    return null
  }
}

function writeActiveProbe(domain: string, endpoint: string): ActiveProbe | null {
  if (typeof window === 'undefined') return null
  const activeProbe = { domain, endpoint, startedAt: Date.now() }
  window.sessionStorage.setItem(ACTIVE_PROBE_STORAGE_KEY, JSON.stringify(activeProbe))
  return activeProbe
}

function clearActiveProbe() {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(ACTIVE_PROBE_STORAGE_KEY)
    window.sessionStorage.removeItem(ACTIVE_PROBE_RESULT_STORAGE_KEY)
  }
}

function probeMatchesActive(result: DomainProbeResult, activeProbe: ActiveProbe): boolean {
  return (
    result.domain === activeProbe.domain &&
    normalizeEndpoint(result.endpoint) === normalizeEndpoint(activeProbe.endpoint)
  )
}

function readActiveProbeResult(activeProbe: ActiveProbe): DomainProbeResult | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_PROBE_RESULT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt?: number; result?: DomainProbeResult }
    if (
      typeof parsed.savedAt !== 'number' ||
      !parsed.result ||
      Date.now() - parsed.savedAt > ACTIVE_PROBE_TTL_MS ||
      !probeMatchesActive(parsed.result, activeProbe)
    ) {
      window.sessionStorage.removeItem(ACTIVE_PROBE_RESULT_STORAGE_KEY)
      return null
    }
    return parsed.result
  } catch {
    window.sessionStorage.removeItem(ACTIVE_PROBE_RESULT_STORAGE_KEY)
    return null
  }
}

function writeActiveProbeResult(result: DomainProbeResult) {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(
      ACTIVE_PROBE_RESULT_STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), result }),
    )
  }
}

function StatusIcon({ check }: { check: ProbeCheck }) {
  if (check.state === 'pass') return <CheckCircle2 className="size-4 text-emerald-500" />
  if (check.state === 'skip') return <AlertTriangle className="size-4 text-amber-500" />
  return <AlertTriangle className="size-4 text-destructive" />
}

function checkingDetailFor(label: string) {
  if (label === 'LNURL') return 'Checking Lightning Address discovery.'
  if (label === 'NIP-05') return 'Checking Nostr identity discovery.'
  return 'Checking discovery.'
}

function DiscoveryStatusList({ checks, loading = false }: { checks: ProbeCheck[]; loading?: boolean }) {
  return (
    <div className="divide-y rounded-md border bg-background">
      {checks.map(check => (
        <div key={check.label} className="flex gap-3 p-3">
          <span
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-full',
              loading ? 'bg-primary/10 text-primary' : 'bg-muted',
            )}
          >
            {loading ? <Spinner size={16} /> : <StatusIcon check={check} />}
          </span>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">{check.label}</p>
            <p className="text-xs leading-5 text-muted-foreground">
              {loading ? checkingDetailFor(check.label) : check.detail}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function DiscoveryCheckingList() {
  const checks = [
    {
      label: 'LNURL',
      detail: 'Checking Lightning Address discovery.',
    },
    {
      label: 'NIP-05',
      detail: 'Checking Nostr identity discovery.',
    },
  ]

  return (
    <div className="divide-y rounded-md border bg-background text-left">
      {checks.map(check => (
        <div key={check.label} className="flex gap-3 p-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10">
            <Spinner size={16} />
          </span>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">{check.label}</p>
            <p className="text-xs leading-5 text-muted-foreground">{check.detail}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

/** WordPress brand mark from Simple Icons, rendered inline to avoid a dependency. */
function WordPressIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M21.469 6.825c.84 1.537 1.318 3.3 1.318 5.175 0 3.979-2.156 7.456-5.363 9.325l3.295-9.527c.615-1.54.82-2.771.82-3.864 0-.405-.026-.78-.07-1.11m-7.981.105c.647-.03 1.232-.105 1.232-.105.582-.075.514-.93-.067-.899 0 0-1.755.135-2.88.135-1.064 0-2.85-.15-2.85-.15-.585-.03-.661.855-.075.885 0 0 .54.061 1.125.09l1.68 4.605-2.37 7.08L5.354 6.9c.649-.03 1.234-.1 1.234-.1.585-.075.516-.93-.065-.896 0 0-1.746.138-2.874.138-.2 0-.438-.008-.69-.015C4.911 3.15 8.235 1.215 12 1.215c2.809 0 5.365 1.072 7.286 2.833-.046-.003-.091-.009-.141-.009-1.06 0-1.812.923-1.812 1.914 0 .89.513 1.643 1.06 2.531.411.72.89 1.643.89 2.977 0 .915-.354 1.994-.821 3.479l-1.075 3.585-3.9-11.61.001.014zM12 22.784c-1.059 0-2.081-.153-3.048-.437l3.237-9.406 3.315 9.087c.024.053.05.101.078.149-1.12.393-2.325.609-3.582.609M1.211 12c0-1.564.336-3.05.935-4.39L7.29 21.709C3.694 19.96 1.212 16.271 1.211 12M12 0C5.385 0 0 5.385 0 12s5.385 12 12 12 12-5.385 12-12S18.615 0 12 0" />
    </svg>
  )
}

function PlatformBadge({ platform }: { platform: DomainProbeResult['platform'] }) {
  if (platform.kind === 'wordpress') {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-[#21759B]/40 bg-[#21759B] px-2.5 text-white hover:bg-[#21759B]"
      >
        <WordPressIcon className="size-3.5" />
        WordPress
      </Badge>
    )
  }

  return <Badge variant="outline">{platform.label}</Badge>
}

function WordPressPluginCallout({ endpoint }: { endpoint: string }) {
  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpoint)
    toast.success('Instance URL copied')
  }

  return (
    <div className="space-y-4 rounded-md border border-[#21759B]/35 bg-[#21759B]/10 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#21759B] text-white shadow-sm">
            <WordPressIcon className="size-6" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold">WordPress detected</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Setup plugin to connect to this instance.
            </p>
          </div>
        </div>
        <Button asChild size="lg" className="h-12 shrink-0 px-5 text-sm">
          <a href={WORDPRESS_PLUGIN_URL} target="_blank" rel="noopener noreferrer">
            <WordPressIcon className="size-4" />
            Download plugin
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>

      <div className="rounded-md border border-[#21759B]/25 bg-background/80 p-3">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Plugin instance URL
          </p>
          <div className="relative min-w-0">
            <code className="block min-h-12 w-full truncate rounded-md bg-muted py-3 pl-3 pr-14 text-sm font-semibold leading-6 text-foreground">
              {endpoint}
            </code>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute right-2 top-1/2 size-8 -translate-y-1/2"
              onClick={copyEndpoint}
              aria-label="Copy plugin instance URL"
            >
              <Clipboard className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const CONFETTI_PIECES = [
  { left: '8%', delay: '0ms', color: '#22c55e', size: 7, travel: -68, rotate: -24 },
  { left: '18%', delay: '70ms', color: '#38bdf8', size: 5, travel: -88, rotate: 31 },
  { left: '29%', delay: '35ms', color: '#f59e0b', size: 8, travel: -76, rotate: 42 },
  { left: '39%', delay: '115ms', color: '#ef4444', size: 5, travel: -94, rotate: -38 },
  { left: '50%', delay: '15ms', color: '#84cc16', size: 7, travel: -84, rotate: 28 },
  { left: '61%', delay: '95ms', color: '#06b6d4', size: 6, travel: -72, rotate: -30 },
  { left: '72%', delay: '45ms', color: '#f97316', size: 8, travel: -90, rotate: 36 },
  { left: '84%', delay: '125ms', color: '#10b981', size: 5, travel: -78, rotate: -27 },
  { left: '93%', delay: '60ms', color: '#eab308', size: 7, travel: -86, rotate: 24 },
]

function SuccessConfetti() {
  return (
    <div className="pointer-events-none absolute inset-x-3 top-4 h-32 overflow-hidden" aria-hidden="true">
      <style>
        {`
          @keyframes domain-confetti-pop {
            0% { opacity: 0; transform: translate3d(0, 28px, 0) scale(0.45) rotate(0deg); }
            18% { opacity: 1; }
            100% { opacity: 0; transform: translate3d(var(--confetti-x), var(--confetti-y), 0) scale(1) rotate(var(--confetti-rotate)); }
          }
          @media (prefers-reduced-motion: reduce) {
            .domain-confetti-piece { animation: none !important; opacity: 0.8; }
          }
        `}
      </style>
      {CONFETTI_PIECES.map((piece, index) => (
        <span
          key={`${piece.left}-${index}`}
          className="domain-confetti-piece absolute bottom-0 rounded-[2px]"
          style={{
            left: piece.left,
            width: piece.size,
            height: piece.size + 4,
            backgroundColor: piece.color,
            animation: 'domain-confetti-pop 980ms cubic-bezier(0.16, 1, 0.3, 1) both',
            animationDelay: piece.delay,
            ['--confetti-x' as string]: `${(index % 2 === 0 ? 1 : -1) * (18 + index * 3)}px`,
            ['--confetti-y' as string]: `${piece.travel}px`,
            ['--confetti-rotate' as string]: `${piece.rotate * 6}deg`,
          }}
        />
      ))}
    </div>
  )
}

function SuccessCheckmark() {
  return (
    <div className="relative mx-auto grid size-20 place-items-center">
      <span className="absolute inset-0 rounded-full bg-emerald-500/15 animate-ping motion-reduce:animate-none" />
      <span className="absolute inset-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 shadow-[0_0_40px_rgba(16,185,129,0.25)]" />
      <span className="relative grid size-14 place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/25">
        <Check className="size-7" strokeWidth={3} />
      </span>
    </div>
  )
}

function ConnectedMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md border bg-background/80 p-3 shadow-sm">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-500">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold">{value}</p>
      </div>
    </div>
  )
}

function ConnectedCheckPill({ check }: { check: ProbeCheck }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border bg-background/80 px-3 py-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/10">
        <StatusIcon check={check} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{check.label}</p>
        <p className="text-xs text-muted-foreground">Ready</p>
      </div>
    </div>
  )
}

function DomainConnectedScreen({
  result,
  domain,
  endpoint,
  probing,
}: {
  result: DomainProbeResult
  domain: string
  endpoint: string
  probing: boolean
}) {
  return (
    <div className="relative isolate min-w-0 overflow-hidden rounded-md border border-emerald-500/25 bg-emerald-500/[0.03] p-4">
      <SuccessConfetti />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent" />
      <div className="relative space-y-4">
        <SuccessCheckmark />

        <div className="mx-auto max-w-sm space-y-2 text-center">
          <Badge className="border-emerald-400/40 bg-emerald-500 text-white hover:bg-emerald-500">
            Domain verified
          </Badge>
          <h3 className="text-xl font-semibold tracking-normal">Domain successfully connected</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            LNURL and NIP-05 discovery are now routed through this LaWallet instance.
          </p>
        </div>

        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <ConnectedMetric label="Domain" value={domain || result.domain} icon={Globe2} />
          <ConnectedMetric label="Instance" value={endpoint || result.endpoint} icon={LockKeyhole} />
        </div>

        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <ConnectedCheckPill check={result.checks.lnurl} />
          <ConnectedCheckPill check={result.checks.nip05} />
        </div>

        {result.platform.kind === 'wordpress' && <WordPressPluginCallout endpoint={endpoint} />}

        <div
          className={cn(
            'flex justify-center transition-opacity duration-150',
            probing ? 'opacity-100' : 'invisible opacity-0',
          )}
        >
          <Badge variant="outline" className="gap-1.5 bg-background/80">
            <Spinner size={12} />
            Re-checking
          </Badge>
        </div>
      </div>
    </div>
  )
}

function InstructionChooser({
  options,
  selected,
  search,
  onSearchChange,
  onSelect,
}: {
  options: InstructionProfile[]
  selected?: InstructionProfile
  search: string
  onSearchChange: (value: string) => void
  onSelect: (option: InstructionProfile) => void
}) {
  const filtered = options.filter(option => {
    const query = search.trim().toLowerCase()
    const haystack = `${option.label ?? ''} ${option.title} ${option.summary}`.toLowerCase()
    return haystack.includes(query)
  })

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2 rounded-md border bg-background px-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={search}
          onChange={event => onSearchChange(event.target.value)}
          placeholder="Search infrastructure"
          className="h-8 border-0 px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
      <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
        {filtered.map(option => (
          <button
            key={option.kind ?? option.title}
            type="button"
            onClick={() => onSelect(option)}
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
              selected?.kind === option.kind
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground',
            )}
          >
            {option.label ?? option.title}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground">No matching infrastructure.</p>
        )}
      </div>
    </div>
  )
}

function NetworkIllustration({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 220 120"
      className="h-28 w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="domain-wizard-line" x1="0" x2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      <path
        d="M48 60 C84 18 135 102 172 60"
        fill="none"
        stroke="url(#domain-wizard-line)"
        strokeWidth="4"
        strokeLinecap="round"
        className={cn(active && 'animate-pulse')}
      />
      <circle cx="44" cy="60" r="23" className="fill-background stroke-border" strokeWidth="2" />
      <circle cx="176" cy="60" r="23" className="fill-background stroke-border" strokeWidth="2" />
      <circle cx="44" cy="60" r="7" className="fill-primary" />
      <path d="M166 60 h20 M176 50 v20" className="stroke-primary" strokeWidth="4" strokeLinecap="round" />
      <circle
        cx={active ? '112' : '100'}
        cy="60"
        r="8"
        className={cn('fill-emerald-500 transition-all duration-700', active && 'opacity-80')}
      />
    </svg>
  )
}

export function DomainOnboardingWizard({
  open,
  onOpenChange,
  initialDomain,
  initialEndpoint,
  currentOrigin,
  latestProbeResult,
  latestProbeError,
  latestProbeChecking = false,
  onConfigured,
  updateSettings,
}: DomainOnboardingWizardProps) {
  const { apiClient } = useAuth()
  const [step, setStep] = useState<WizardStep>('input')
  const [domain, setDomain] = useState(initialDomain)
  const [endpoint, setEndpoint] = useState(initialEndpoint)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [result, setResult] = useState<DomainProbeResult | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [instructionSearch, setInstructionSearch] = useState('')
  const [selectedInstructionKind, setSelectedInstructionKind] = useState<string | null>(null)
  const openInitializedRef = useRef(false)
  const activeProbeRef = useRef<ActiveProbe | null>(null)
  const resumedProbeKeyRef = useRef<string | null>(null)

  const cleanDomain = domain.trim().toLowerCase()
  const endpointValue = normalizeEndpoint(endpoint)
  const probeEndpointValue = endpointValue || currentOrigin
  const invalidDomain = cleanDomain !== '' && !DOMAIN_PATTERN.test(cleanDomain)
  const lawalletHost = useMemo(
    () => (cleanDomain ? `lawallet.${cleanDomain}` : 'lawallet.example.com'),
    [cleanDomain],
  )

  useEffect(() => {
    if (!open) {
      openInitializedRef.current = false
      return
    }
    if (openInitializedRef.current) return
    openInitializedRef.current = true

    const activeProbe = readActiveProbe()
    const activeProbeResult = activeProbe ? readActiveProbeResult(activeProbe) : null
    activeProbeRef.current = activeProbe
    setDomain(activeProbe?.domain ?? initialDomain)
    setEndpoint(activeProbe?.endpoint ?? initialEndpoint)
    setStep(activeProbeResult ? 'result' : activeProbe ? 'checking' : 'input')
    setResult(activeProbeResult)
    setProbeError(null)
    setInstructionSearch('')
    setSelectedInstructionKind(null)
  }, [initialDomain, initialEndpoint, open])

  useEffect(() => {
    if (!open || step !== 'input') return
    setDomain(prev => prev || initialDomain)
    setEndpoint(prev => prev || initialEndpoint)
  }, [initialDomain, initialEndpoint, open, step])

  useEffect(() => {
    if (!open || saving || probing) return

    const activeProbe = activeProbeRef.current ?? readActiveProbe()
    if (!activeProbe) return
    activeProbeRef.current = activeProbe

    if (latestProbeChecking && step !== 'result' && !result && !probeError) {
      setStep('checking')
      return
    }

    const latestProbeMatches =
      latestProbeResult?.domain === activeProbe.domain &&
      normalizeEndpoint(latestProbeResult.endpoint) === normalizeEndpoint(activeProbe.endpoint)

    if (latestProbeMatches) {
      writeActiveProbeResult(latestProbeResult)
      setDomain(activeProbe.domain)
      setEndpoint(activeProbe.endpoint)
      setResult(latestProbeResult)
      setProbeError(null)
      setInstructionSearch('')
      setSelectedInstructionKind(null)
      setStep('result')
      return
    }

    if (latestProbeError) {
      setProbeError(latestProbeError)
      setResult(null)
      setStep('result')
    }
  }, [
    latestProbeChecking,
    latestProbeError,
    latestProbeResult,
    open,
    probing,
    probeError,
    result,
    saving,
    step,
  ])

  const runProbe = useCallback(async (
    nextDomain = cleanDomain,
    nextEndpoint = probeEndpointValue,
    options: ProbeRunOptions = {},
  ) => {
    const preserveVisibleResult =
      options.preserveVisibleResult === true && step === 'result' && Boolean(result || probeError)

    setProbing(true)
    if (!preserveVisibleResult) {
      setStep('checking')
      setResult(null)
      setProbeError(null)
    }
    try {
      const probe = await apiClient.post<DomainProbeResult>('/api/settings/domain-probe', {
        domain: nextDomain,
        endpoint: nextEndpoint,
        apiGatewayEndpoint: currentOrigin,
      })
      writeActiveProbeResult(probe)
      setResult(probe)
      setProbeError(null)
      setInstructionSearch('')
      setSelectedInstructionKind(null)
      setStep('result')
      invalidateApiPath('/api/settings')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Domain check failed'
      setProbeError(message)
      if (!preserveVisibleResult) setResult(null)
      toast.error(message)
      setStep('result')
    } finally {
      setProbing(false)
    }
  }, [apiClient, cleanDomain, currentOrigin, probeEndpointValue, probeError, result, step])

  useEffect(() => {
    if (!open || saving || probing || step !== 'checking') return

    const activeProbe = activeProbeRef.current ?? readActiveProbe()
    if (!activeProbe) return
    activeProbeRef.current = activeProbe

    const probeKey = `${activeProbe.domain}|${activeProbe.endpoint}|${activeProbe.startedAt}`
    if (resumedProbeKeyRef.current === probeKey) return
    resumedProbeKeyRef.current = probeKey

    void runProbe(activeProbe.domain, activeProbe.endpoint)
  }, [open, probing, runProbe, saving, step])

  async function handleStart() {
    if (!cleanDomain || invalidDomain) {
      toast.error('Enter a valid domain first')
      return
    }

    activeProbeRef.current = writeActiveProbe(cleanDomain, probeEndpointValue)
    setResult(null)
    setProbeError(null)
    setStep('checking')
    setSaving(true)
    try {
      await updateSettings({
        domain: cleanDomain,
        ...(endpointValue ? { endpoint: endpointValue } : {}),
      })
      onConfigured({ domain: cleanDomain, endpoint: endpointValue || initialEndpoint })
      toast.success('Domain saved')
      setSaving(false)
      await runProbe(cleanDomain, probeEndpointValue)
    } catch (error) {
      activeProbeRef.current = null
      clearActiveProbe()
      setStep('input')
      setResult(null)
      setProbeError(null)
      toast.error(error instanceof Error ? error.message : 'Could not save domain')
    } finally {
      setSaving(false)
    }
  }

  async function copySnippet() {
    if (!selectedInstruction) return
    await navigator.clipboard.writeText(selectedInstruction.snippet)
    toast.success('Copied')
  }

  function resetAndClose(nextOpen: boolean) {
    if (!nextOpen && (saving || probing)) return
    onOpenChange(nextOpen)
    if (!nextOpen) {
      activeProbeRef.current = null
      clearActiveProbe()
      setStep('input')
      setResult(null)
      setProbeError(null)
      setInstructionSearch('')
      setSelectedInstructionKind(null)
      setSaving(false)
      setProbing(false)
    }
  }

  const ready = !probeError && result?.status === 'ready'
  const rewriteNeeded = !probeError && result?.status === 'rewrite-needed'
  const requiresInstructionChoice = Boolean(
    result &&
    result.status !== 'ready' &&
    (
      result.instructions.kind === 'unknown' ||
      result.platform.kind === 'unknown' ||
      result.platform.confidence === 'low' ||
      (result.platform.kind === 'lawallet' && result.checks.instance.state !== 'pass')
    ),
  )
  const selectedInstruction =
    result?.instructionOptions.find(option => option.kind === selectedInstructionKind) ??
    (requiresInstructionChoice ? undefined : result?.instructions)
  const wordpressDetected = result?.platform.kind === 'wordpress'
  const showManualInstructions = Boolean(result && !wordpressDetected)

  function renderStepPanel(panelStep: WizardStep, children: React.ReactNode, className?: string) {
    const active = step === panelStep

    return (
      <div
        aria-hidden={!active}
        className={cn(
          'col-start-1 row-start-1 min-w-0 transition-opacity duration-200 ease-out motion-reduce:transition-none',
          active ? 'visible opacity-100' : 'pointer-events-none invisible opacity-0',
          className,
        )}
      >
        {children}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] min-w-0 max-h-[92vh] overflow-x-hidden overflow-y-auto sm:max-w-[560px]"
        onChange={event => event.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-emerald-500 to-cyan-500" />
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
              <WandSparkles className="size-4" />
            </span>
            Domain setup
          </DialogTitle>
          <DialogDescription>
            Save the domain, then check wallet discovery.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          {(['input', 'checking', 'result'] as WizardStep[]).map((item, index) => (
            <div
              key={item}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                index <= ['input', 'checking', 'result'].indexOf(step)
                  ? 'bg-primary'
                  : 'bg-muted',
              )}
            />
          ))}
        </div>

        <div className="grid min-w-0 min-h-[340px] overflow-hidden">
          {renderStepPanel(
            'input',
            <>
              <NetworkIllustration active={false} />

              <div className="grid min-w-0 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="domain-setup-domain">Domain</Label>
                  <InputGroup className={cn('min-w-0', invalidDomain && 'border-destructive')}>
                    <InputGroupText>https://</InputGroupText>
                    <Input
                      id="domain-setup-domain"
                      autoFocus
                      placeholder="example.com"
                      value={domain}
                      onChange={event => setDomain(event.target.value)}
                      className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </InputGroup>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="domain-setup-endpoint">LaWallet endpoint</Label>
                  <Input
                    id="domain-setup-endpoint"
                    className="min-w-0"
                    placeholder={currentOrigin || lawalletHost}
                    value={endpoint}
                    onChange={event => setEndpoint(event.target.value)}
                  />
                </div>
              </div>

              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-start gap-3">
                  <Route className="mt-0.5 size-4 text-primary" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Flexible hosting</p>
                    <p className="text-xs text-muted-foreground">
                      Host LaWallet at <span className="font-mono text-foreground">{lawalletHost}</span> and keep
                      your main landing page on the root domain.
                    </p>
                  </div>
                </div>
              </div>
            </>,
            'space-y-5 p-1',
          )}

          {renderStepPanel(
            'checking',
            <>
              <div className="space-y-2 text-center">
                <h3 className="text-base font-semibold">
                  {saving ? 'Saving domain' : 'Checking routes'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  LNURL and NIP-05 discovery are being tested from the server.
                </p>
              </div>
              <DiscoveryCheckingList />
            </>,
            'flex min-w-0 min-h-[340px] flex-col justify-center gap-4',
          )}

          {renderStepPanel(
            'result',
            <>
              {ready && result ? (
                <DomainConnectedScreen
                  result={result}
                  domain={cleanDomain}
                  endpoint={probeEndpointValue}
                  probing={probing}
                />
              ) : (
                <>
                  <div className="flex min-h-6 flex-wrap items-center gap-2">
                    {result && <PlatformBadge platform={result.platform} />}
                    <Badge
                      variant="outline"
                      className={cn(
                        'gap-1.5 transition-opacity duration-150',
                        probing ? 'opacity-100' : 'invisible opacity-0',
                      )}
                    >
                      <Spinner size={12} />
                      Re-checking
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold">
                      {probeError
                        ? 'Check could not finish'
                        : wordpressDetected
                          ? 'Install the WordPress plugin'
                        : rewriteNeeded
                          ? 'Route .well-known here'
                          : 'Saved. Check routing next.'}
                    </h3>
                    {!wordpressDetected && (
                      <p className="text-sm text-muted-foreground">
                        {requiresInstructionChoice && !selectedInstruction
                          ? 'Choose your backend to see the right rewrite instructions.'
                          : probeError ?? result?.instructions.summary ?? 'The domain was saved, but the check could not finish.'}
                      </p>
                    )}
                  </div>

                  {result && (
                    <>
                      {result.platform.kind === 'wordpress' && (
                        <WordPressPluginCallout endpoint={result.endpoint || probeEndpointValue} />
                      )}

                      <DiscoveryStatusList
                        checks={[result.checks.lnurl, result.checks.nip05]}
                        loading={probing}
                      />

                      {showManualInstructions && requiresInstructionChoice && (
                        <InstructionChooser
                          options={result.instructionOptions}
                          selected={selectedInstruction}
                          search={instructionSearch}
                          onSearchChange={setInstructionSearch}
                          onSelect={option => setSelectedInstructionKind(option.kind ?? option.title)}
                        />
                      )}

                      {showManualInstructions && selectedInstruction ? (
                        <div className="rounded-md border bg-background">
                          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{selectedInstruction.title}</p>
                              <p className="text-xs leading-5 text-muted-foreground">{selectedInstruction.tip}</p>
                            </div>
                            <Button variant="ghost" size="icon" onClick={copySnippet}>
                              <Clipboard className="size-4" />
                            </Button>
                          </div>
                          <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-all p-3 text-xs">
                            <code>{selectedInstruction.snippet}</code>
                          </pre>
                        </div>
                      ) : showManualInstructions ? (
                        <div className="rounded-md border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
                          Choose an infrastructure option first.
                        </div>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </>,
            'min-w-0 space-y-4',
          )}
        </div>

        <DialogFooter className="min-h-10 gap-2 sm:gap-2">
          {step === 'input' ? (
            <Button onClick={handleStart} disabled={saving || !cleanDomain || invalidDomain}>
              {saving ? <Spinner size={16} className="mr-2" /> : <Sparkles className="mr-2 size-4" />}
              Verify
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => runProbe(undefined, undefined, { preserveVisibleResult: true })}
                disabled={saving || probing || !cleanDomain}
              >
                {probing ? <Spinner size={16} className="mr-2" /> : <RefreshCw className="mr-2 size-4" />}
                Re-check
              </Button>
              <Button onClick={() => resetAndClose(false)} disabled={saving || probing}>
                {ready ? <Check className="mr-2 size-4" /> : <Globe2 className="mr-2 size-4" />}
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
