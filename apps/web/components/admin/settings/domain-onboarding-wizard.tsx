'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clipboard,
  Globe2,
  RefreshCw,
  Route,
  Search,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import type { DomainProbeResult, InstructionProfile, ProbeCheck } from '@/lib/domain-onboarding'
import { useAuth } from '@/components/admin/auth-context'
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

type WizardStep = 'input' | 'checking' | 'result'

interface DomainOnboardingWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDomain: string
  initialEndpoint: string
  currentOrigin: string
  onConfigured: (values: { domain: string; endpoint: string }) => void
  updateSettings: (data: Record<string, string>) => Promise<unknown>
}

function normalizeEndpoint(endpoint: string, domain: string): string {
  const cleaned = endpoint.trim().replace(/\/+$/, '').toLowerCase()
  if (cleaned) return cleaned
  return domain.trim().toLowerCase()
}

function StatusIcon({ check }: { check: ProbeCheck }) {
  if (check.state === 'pass') return <CheckCircle2 className="size-4 text-emerald-500" />
  if (check.state === 'skip') return <AlertTriangle className="size-4 text-amber-500" />
  return <AlertTriangle className="size-4 text-destructive" />
}

function DiscoveryStatusList({ checks }: { checks: ProbeCheck[] }) {
  return (
    <div className="divide-y rounded-md border bg-background">
      {checks.map(check => (
        <div key={check.label} className="flex gap-3 p-3">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted">
            <StatusIcon check={check} />
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
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10">
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

function InstructionChooser({
  options,
  selected,
  search,
  onSearchChange,
  onSelect,
}: {
  options: InstructionProfile[]
  selected: InstructionProfile
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
              selected.kind === option.kind
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
      role="img"
      aria-label="Domain routing"
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
  const [instructionSearch, setInstructionSearch] = useState('')
  const [selectedInstructionKind, setSelectedInstructionKind] = useState<string | null>(null)

  const cleanDomain = domain.trim().toLowerCase()
  const endpointValue = normalizeEndpoint(endpoint, cleanDomain)
  const invalidDomain = cleanDomain !== '' && !DOMAIN_PATTERN.test(cleanDomain)
  const lawalletHost = useMemo(
    () => (cleanDomain ? `lawallet.${cleanDomain}` : 'lawallet.example.com'),
    [cleanDomain],
  )

  useEffect(() => {
    if (!open) return
    setDomain(initialDomain)
    setEndpoint(initialEndpoint)
  }, [initialDomain, initialEndpoint, open])

  async function runProbe(nextDomain = cleanDomain, nextEndpoint = endpointValue) {
    setProbing(true)
    setStep('checking')
    try {
      const probe = await apiClient.post<DomainProbeResult>('/api/settings/domain-probe', {
        domain: nextDomain,
        endpoint: nextEndpoint,
        apiGatewayEndpoint: currentOrigin,
      })
      setResult(probe)
      setInstructionSearch('')
      setSelectedInstructionKind(null)
      setStep('result')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Domain check failed')
      setStep('result')
    } finally {
      setProbing(false)
    }
  }

  async function handleStart() {
    if (!cleanDomain || invalidDomain) {
      toast.error('Enter a valid domain first')
      return
    }

    setSaving(true)
    try {
      await updateSettings({
        domain: cleanDomain,
        endpoint: endpointValue,
      })
      onConfigured({ domain: cleanDomain, endpoint: endpointValue })
      toast.success('Domain saved')
      setSaving(false)
      await runProbe(cleanDomain, endpointValue)
    } catch (error) {
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
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setStep('input')
      setResult(null)
      setInstructionSearch('')
      setSelectedInstructionKind(null)
      setSaving(false)
      setProbing(false)
    }
  }

  const ready = result?.status === 'ready'
  const pending = result?.status === 'pending'
  const rewriteNeeded = result?.status === 'rewrite-needed'
  const showInstructionChooser = Boolean(
    result &&
    result.status !== 'ready' &&
    (result.platform.kind === 'unknown' || result.platform.confidence === 'low'),
  )
  const selectedInstruction =
    result?.instructionOptions.find(option => option.kind === selectedInstructionKind) ??
    result?.instructions

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] min-w-0 max-h-[92vh] overflow-x-hidden overflow-y-auto sm:max-w-[560px]">
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

        <div className="min-w-0 min-h-[320px]">
          {step === 'input' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-5">
              <NetworkIllustration active={false} />

              <div className="grid min-w-0 gap-4">
                <div className="space-y-1">
                  <Label>Domain</Label>
                  <InputGroup className={cn('min-w-0', invalidDomain && 'border-destructive')}>
                    <InputGroupText>https://</InputGroupText>
                    <Input
                      autoFocus
                      placeholder="example.com"
                      value={domain}
                      onChange={event => setDomain(event.target.value)}
                      className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </InputGroup>
                </div>

                <div className="space-y-1">
                  <Label>LaWallet endpoint</Label>
                  <Input
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
            </div>
          )}

          {step === 'checking' && (
            <div className="animate-in fade-in zoom-in-95 duration-300 flex min-w-0 min-h-[320px] flex-col justify-center gap-4">
              <div className="space-y-2 text-center">
                <h3 className="text-base font-semibold">
                  {saving ? 'Saving domain' : 'Checking routes'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  LNURL and NIP-05 discovery are being tested from the server.
                </p>
              </div>
              <DiscoveryCheckingList />
            </div>
          )}

          {step === 'result' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {result && <PlatformBadge platform={result.platform} />}
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">
                  {ready
                    ? 'Discovery is ready'
                    : rewriteNeeded
                      ? 'Route .well-known here'
                      : 'Saved. Check routing next.'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {result?.instructions.summary ?? 'The domain was saved, but the check could not finish.'}
                </p>
              </div>

              {result && (
                <>
                  <DiscoveryStatusList checks={[result.checks.lnurl, result.checks.nip05]} />

                  {showInstructionChooser && selectedInstruction && (
                    <InstructionChooser
                      options={result.instructionOptions}
                      selected={selectedInstruction}
                      search={instructionSearch}
                      onSearchChange={setInstructionSearch}
                      onSelect={option => setSelectedInstructionKind(option.kind ?? option.title)}
                    />
                  )}

                  <div className="rounded-md border bg-background">
                    <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{selectedInstruction?.title}</p>
                        <p className="text-xs leading-5 text-muted-foreground">{selectedInstruction?.tip}</p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={copySnippet}>
                        <Clipboard className="size-4" />
                      </Button>
                    </div>
                    <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-all p-3 text-xs">
                      <code>{selectedInstruction?.snippet}</code>
                    </pre>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {step === 'input' ? (
            <Button onClick={handleStart} disabled={saving || !cleanDomain || invalidDomain}>
              {saving ? <Spinner size={16} className="mr-2" /> : <Sparkles className="mr-2 size-4" />}
              Save & check
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => runProbe()} disabled={probing || !cleanDomain}>
                {probing ? <Spinner size={16} className="mr-2" /> : <RefreshCw className="mr-2 size-4" />}
                Re-check
              </Button>
              <Button onClick={() => resetAndClose(false)}>
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
