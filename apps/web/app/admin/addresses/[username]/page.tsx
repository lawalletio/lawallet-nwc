'use client'

import React, { useEffect, useRef, useState, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Forward,
  Plus,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { LightningAddressHero } from '@/components/admin/lightning-address-hero'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { BalanceCard } from '@/components/wallet/balance-card'
import { AddressInvoicesCard } from '@/components/wallet/address-invoices-card'
import { CreateRemoteWalletDialog } from '@/components/admin/create-remote-wallet-dialog'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { invalidateApiPath } from '@/lib/client/hooks/use-api'
import {
  useMyAddress,
  useAddressMutations,
  type AliasProbeCheckKey,
  type AliasProbeCheckResult,
  type AliasProbeResponse,
  type LightningAddressMode,
  type WalletRemoteWalletSummary,
} from '@/lib/client/hooks/use-wallet-addresses'
import { isLightningAddress } from '@/lib/ln-address'
import { ApiClientError } from '@/lib/client/api-client'
import { truncateNpub } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

const MODE_DESCRIPTIONS: Record<
  LightningAddressMode,
  { label: string; help: string }
> = {
  IDLE: { label: 'Idle', help: 'Address is disabled and rejects payments.' },
  ALIAS: { label: 'Alias', help: 'Forward incoming payments to another lightning address.' },
  CUSTOM_NWC: { label: 'Custom wallet', help: 'Receive via a specific wallet.' },
  DEFAULT_NWC: { label: 'Primary wallet', help: 'Use the wallet linked to your primary address.' },
}

const CONNECT_NEW_WALLET_VALUE = '__connect_new_wallet__'

type AliasProbePhase = 'idle' | 'checking' | 'blocked' | 'warnings' | 'saving'
type AliasProbeUiStatus = 'pending' | 'valid' | 'invalid'
type AliasProbeUiCheck = AliasProbeCheckResult & {
  status: AliasProbeUiStatus
}

const ALIAS_PROBE_CHECKS: Array<{
  key: AliasProbeCheckKey
  label: string
  description: string
}> = [
  {
    key: 'lud16',
    label: 'LUD-16',
    description: 'Resolves the Lightning Address payRequest metadata.',
  },
  {
    key: 'lud21',
    label: 'LUD-21',
    description: 'Confirms the callback exposes a verify URL.',
  },
  {
    key: 'nip57',
    label: 'NIP-57',
    description: 'Checks whether zap metadata is advertised.',
  },
]

function createPendingAliasProbeChecks(): Record<AliasProbeCheckKey, AliasProbeUiCheck> {
  return {
    lud16: { ok: false, status: 'pending', message: 'Resolving payRequest metadata…' },
    lud21: { ok: false, status: 'pending', message: 'Requesting a probe invoice…' },
    nip57: { ok: false, status: 'pending', message: 'Reading zap capability metadata…' },
  }
}

function createFailedAliasProbeChecks(message: string): Record<AliasProbeCheckKey, AliasProbeUiCheck> {
  return {
    lud16: { ok: false, status: 'invalid', message },
    lud21: { ok: false, status: 'invalid', message: 'Not checked because the probe failed.' },
    nip57: { ok: false, status: 'invalid', message: 'Not checked because the probe failed.' },
  }
}

function mapAliasProbeChecks(
  result: AliasProbeResponse
): Record<AliasProbeCheckKey, AliasProbeUiCheck> {
  return {
    lud16: {
      ...result.checks.lud16,
      status: result.checks.lud16.ok ? 'valid' : 'invalid',
    },
    lud21: {
      ...result.checks.lud21,
      status: result.checks.lud21.ok ? 'valid' : 'invalid',
    },
    nip57: {
      ...result.checks.nip57,
      status: result.checks.nip57.ok ? 'valid' : 'invalid',
    },
  }
}

function AliasProbeStatusIcon({ status }: { status: AliasProbeUiStatus }) {
  if (status === 'pending') {
    return <Spinner size={16} className="text-muted-foreground" aria-hidden />
  }
  if (status === 'valid') {
    return <CheckCircle2 className="size-4 text-primary" aria-hidden />
  }
  return <XCircle className="size-4 text-destructive" aria-hidden />
}

function aliasProbeProgressValue(status: AliasProbeUiStatus): number {
  return status === 'pending' ? 42 : 100
}

interface PageProps {
  params: Promise<{ username: string }>
}

/**
 * /admin/addresses/[username] — edit a single owned lightning address.
 *
 * Lives under /admin so the chrome (sidebar + admin topbar) is consistent
 * with the listing page. The data is still per-user via /api/wallet/addresses.
 */
export default function AdminAddressEditPage({ params }: PageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { username } = use(params)
  const { data: settings } = useSettings()
  const { data, loading, error, refetch } = useMyAddress(username)
  const {
    updateAddress,
    updating,
    deleteAddress,
    deleting,
    probeAliasAddress,
  } = useAddressMutations()
  const redirectInputRef = useRef<HTMLInputElement>(null)
  const appliedConfigureRef = useRef<string | null>(null)
  const pendingRedirectFocusRef = useRef(false)
  const pendingWalletFocusRef = useRef(false)

  const [mode, setMode] = useState<LightningAddressMode>('DEFAULT_NWC')
  const [redirect, setRedirect] = useState('')
  const [remoteWalletId, setRemoteWalletId] = useState<string>('')
  // Combined busy flag held across the full save flow: mutation + refetch.
  // `updating` alone drops to false as soon as the PUT resolves, but the
  // form's `isDirty` hasn't re-synced until refetch finishes — that gap
  // made the Save button flicker enabled for one frame. Everything on the
  // page disables on this flag (Cancel, Add connection, Save, mode picker)
  // so the user can't double-submit or mutate the form mid-flight.
  const [saving, setSaving] = useState(false)
  // Mode section starts collapsed and shows just a summary of the current
  // mode — balance and transactions are the primary content on this page.
  // Successful save collapses it again so the user returns to a glanceable
  // summary without an extra click.
  const [modeOpen, setModeOpen] = useState(false)
  // Delete confirmation dialog — irreversible, so it's gated behind a prompt.
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [createWalletOpen, setCreateWalletOpen] = useState(false)
  const [aliasProbeOpen, setAliasProbeOpen] = useState(false)
  const [aliasProbePhase, setAliasProbePhase] =
    useState<AliasProbePhase>('idle')
  const [aliasProbeAddress, setAliasProbeAddress] = useState('')
  const [aliasProbeResult, setAliasProbeResult] =
    useState<AliasProbeResponse | null>(null)
  const [aliasProbeChecks, setAliasProbeChecks] = useState<
    Record<AliasProbeCheckKey, AliasProbeUiCheck>
  >(() => createPendingAliasProbeChecks())

  // Sync local form state once the address loads. Re-running on `data` covers
  // SSE-driven refetches: we only reset when the loaded record actually
  // changed identity (different updatedAt) so in-flight edits aren't clobbered
  // by background refreshes triggered by our own PUT.
  const updatedAt = data?.address.updatedAt
  useEffect(() => {
    if (!data) return
    setMode(data.address.mode)
    setRedirect(data.address.redirect ?? '')
    setRemoteWalletId(data.address.remoteWalletId ?? '')
  }, [data, updatedAt])

  useEffect(() => {
    if (!data) return

    const configure = searchParams.get('configure')
    const modeIntent = searchParams.get('mode')
    const focusIntent = searchParams.get('focus')
    const intent =
      configure === 'redirect' ||
      modeIntent === 'alias' ||
      focusIntent === 'redirect'
        ? 'redirect'
        : configure === 'wallet' ||
            modeIntent === 'wallet' ||
            modeIntent === 'custom_nwc' ||
            modeIntent === 'custom-wallet' ||
            focusIntent === 'wallet'
          ? 'wallet'
          : null
    if (!intent) return

    const applyKey = `${username}:${intent}:${searchParams.toString()}`
    if (appliedConfigureRef.current === applyKey) return
    appliedConfigureRef.current = applyKey

    setModeOpen(true)

    window.setTimeout(() => {
      document
        .getElementById('address-mode-settings')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 0)

    if (intent === 'redirect') {
      setMode('ALIAS')
      setRemoteWalletId('')
      pendingRedirectFocusRef.current = true
      return
    }

    const preferredWallet =
      data.wallets.find(w => w.isDefault && w.status !== 'DISABLED') ??
      data.wallets.find(w => w.status !== 'DISABLED') ??
      null

    setMode('CUSTOM_NWC')
    setRedirect('')
    setRemoteWalletId(preferredWallet?.id ?? '')
    pendingWalletFocusRef.current = focusIntent === 'wallet'
  }, [data, searchParams, username])

  useEffect(() => {
    if (mode !== 'ALIAS' || !modeOpen || !pendingRedirectFocusRef.current) {
      return
    }

    pendingRedirectFocusRef.current = false
    const frame = window.requestAnimationFrame(() => {
      redirectInputRef.current?.focus()
      redirectInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [mode, modeOpen])

  useEffect(() => {
    if (mode !== 'CUSTOM_NWC' || !modeOpen || !pendingWalletFocusRef.current) {
      return
    }

    pendingWalletFocusRef.current = false
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('remote-wallet')?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [mode, modeOpen])

  const domain = settings?.domain || 'your-domain'
  const fullAddress = `${username}@${domain}`
  const aliasInvalid = mode === 'ALIAS' && redirect.length > 0 && !isLightningAddress(redirect)
  const aliasMissing = mode === 'ALIAS' && redirect.length === 0
  const customMissing = mode === 'CUSTOM_NWC' && !remoteWalletId

  // Dirty check: compare the current form state to the last-saved baseline.
  // `redirect` and `remoteWalletId` are normalised to empty string on load
  // (see the hydration effect above), and the server returns them as `null`
  // when unset, so both sides collapse "empty" to the same sentinel here.
  // Without this the Save button was always enabled as long as inputs were
  // valid, even when the user hadn't touched anything.
  const baseline = data?.address
  const isDirty =
    !!baseline &&
    (mode !== baseline.mode ||
      (redirect ?? '') !== (baseline.redirect ?? '') ||
      (remoteWalletId ?? '') !== (baseline.remoteWalletId ?? ''))

  const saveDisabled =
    saving || updating || !isDirty || aliasInvalid || aliasMissing || customMissing

  const aliasProbeHasOptionalWarnings =
    aliasProbeResult?.canSave === true &&
    (!aliasProbeResult.checks.lud21.ok || !aliasProbeResult.checks.nip57.ok)

  async function persistCurrentAddress() {
    await updateAddress(username, {
      mode,
      redirect: mode === 'ALIAS' ? redirect.trim().toLowerCase() : null,
      remoteWalletId: mode === 'CUSTOM_NWC' ? remoteWalletId : null,
    })
    // Wait for the refetch to land too — this is what prevents the
    // Save button from briefly un-disabling between "mutation done"
    // and "form reset to clean".
    await refetch()
    trackEvent(AnalyticsEvent.ADDRESS_MODE_CHANGED, { mode })
    setModeOpen(false)
    toast.success('Saved')
  }

  async function saveDirectly() {
    setSaving(true)
    try {
      await persistCurrentAddress()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleWalletCreated(wallet: { id: string }) {
    await refetch()
    setMode('CUSTOM_NWC')
    setRemoteWalletId(wallet.id)
    setModeOpen(true)
    window.requestAnimationFrame(() => {
      document.getElementById('remote-wallet')?.focus()
    })
  }

  function handleWalletSelect(value: string) {
    if (value === CONNECT_NEW_WALLET_VALUE) {
      setCreateWalletOpen(true)
      return
    }
    setRemoteWalletId(value)
  }

  async function saveAfterAliasProbeWarnings() {
    if (!aliasProbeResult?.canSave) return

    setSaving(true)
    setAliasProbePhase('saving')
    try {
      await persistCurrentAddress()
      setAliasProbeOpen(false)
      setAliasProbePhase('idle')
    } catch (err) {
      setAliasProbePhase('warnings')
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function runAliasProbeThenSave() {
    const address = redirect.trim().toLowerCase()

    setSaving(true)
    setAliasProbeAddress(address)
    setAliasProbeResult(null)
    setAliasProbeChecks(createPendingAliasProbeChecks())
    setAliasProbePhase('checking')
    setAliasProbeOpen(true)

    try {
      const result = await probeAliasAddress(address)
      setAliasProbeResult(result)
      setAliasProbeChecks(mapAliasProbeChecks(result))

      if (!result.canSave) {
        setAliasProbePhase('blocked')
        toast.error('Alias target failed LUD-16 validation')
        return
      }

      if (!result.checks.lud21.ok || !result.checks.nip57.ok) {
        setAliasProbePhase('warnings')
        return
      }

      setAliasProbePhase('saving')
      try {
        await persistCurrentAddress()
        setAliasProbeOpen(false)
        setAliasProbePhase('idle')
      } catch (err) {
        setAliasProbePhase('warnings')
        toast.error(err instanceof Error ? err.message : 'Failed to save')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Alias validation failed'
      setAliasProbeChecks(createFailedAliasProbeChecks(message))
      setAliasProbePhase('blocked')
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (saveDisabled) return
    if (mode === 'ALIAS') {
      await runAliasProbeThenSave()
      return
    }
    await saveDirectly()
  }

  function handleModeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void handleSave()
  }

  async function handleDelete() {
    try {
      await deleteAddress(username)
      trackEvent(AnalyticsEvent.ADDRESS_DELETED)
      // Drop the cached lists so /admin/addresses mounts on fresh data instead
      // of painting the just-deleted address for a frame. The owner list and
      // the global admin list both surface this address.
      invalidateApiPath('/api/wallet/addresses')
      invalidateApiPath('/api/lightning-addresses')
      invalidateApiPath('/api/lightning-addresses/counts')
      toast.success('Address deleted')
      router.push('/admin/addresses')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete address')
    }
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Lightning Address"
        type="subpage"
        onBack={() => router.push('/admin/addresses')}
      />

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size={24} />
        </div>
      ) : !data ? (
        // Distinguish a genuine 404 from a server/transport error. A DB or
        // upstream failure (e.g. an unapplied migration) used to surface here
        // as "Address not found", which hid the real cause — so only call it
        // "not found" on an actual 404; everything else offers a retry.
        (() => {
          const isNotFound =
            !error || (error instanceof ApiClientError && error.status === 404)
          return (
            <div className="space-y-3 py-12 text-center">
              <p className="text-muted-foreground">
                {isNotFound
                  ? 'Address not found.'
                  : 'Couldn’t load this address. Please try again.'}
              </p>
              <Button
                variant="secondary"
                onClick={() =>
                  isNotFound ? router.push('/admin/addresses') : refetch()
                }
              >
                {isNotFound ? 'Back to addresses' : 'Retry'}
              </Button>
            </div>
          )
        })()
      ) : (() => {
        // `effectiveConnectionString` is resolved server-side by
        // `resolvePaymentRoute`, so it already handles the full fallback
        // chain (CUSTOM_NWC link → DEFAULT_NWC primary → legacy
        // `User.nwc` for un-migrated accounts) without duplicating the
        // logic here. Null for IDLE / ALIAS / unconfigured — the widgets
        // below render an empty state in those cases.
        const persistedMode = data.address.mode
        const defaultWallet = data.wallets.find(w => w.isDefault) ?? null
        // `isOwner` is only `false` when an admin is viewing someone else's
        // address (older responses omit the field → treat as owned). In that
        // mode the page is read-only and the wallet secret is withheld.
        const isOwner = data.isOwner !== false
        const boundWallet =
          data.wallets.find(w => w.id === data.address.remoteWalletId) ?? null
        const modeOptions = (Object.keys(MODE_DESCRIPTIONS) as LightningAddressMode[])
          .filter(option => !(data.address.isPrimary && option === 'DEFAULT_NWC'))

        const emptyReason = !isOwner
          ? // Admin read-only view: the balance needs the owner's connection
            // secret, which we deliberately don't return, so there's nothing to
            // show here.
            'Balance is private to the address owner.'
          : persistedMode === 'IDLE'
            ? 'This address is disabled.'
          : persistedMode === 'ALIAS'
            ? `Forwards to ${data.address.redirect ?? 'another address'}.`
          : persistedMode === 'CUSTOM_NWC'
            ? 'No wallet is linked to this address yet.'
          : 'Set a primary wallet to enable payments.'

        return (
        <div className="space-y-6 px-4 py-6 sm:px-6">
          {/* Centered address hero — the address now leads the page content
              (mirroring the /admin dashboard's centered display) instead of
              sitting in the navbar. */}
          <div className="flex flex-col items-center gap-2 pt-2 text-center">
            <LightningAddressHero address={fullAddress} label="" />
            {isOwner ? (
              <p className="max-w-md text-sm text-muted-foreground">
                Configure how this address handles incoming payments.
              </p>
            ) : (
              <p className="max-w-md text-sm text-muted-foreground">
                Viewing another user&rsquo;s address (read-only). Owner{' '}
                <span
                  className="font-mono text-foreground"
                  title={data.ownerPubkey}
                >
                  {data.ownerPubkey ? truncateNpub(data.ownerPubkey) : 'unknown'}
                </span>
                .
              </p>
            )}
          </div>

          {/* Layout order: balance first (glanceable hero), then Mode so the
              configuration is reachable without scrolling past the whole
              transaction list, then the transactions feed at the bottom. */}
          <BalanceCard
            connectionString={data.effectiveConnectionString}
            emptyReason={emptyReason}
            // ALIAS addresses forward payments — render a forward arrow
            // in the empty-state tile so the visual signals "redirect"
            // instead of the generic NWC-logo used for other empty states.
            emptyIcon={
              persistedMode === 'ALIAS' ? (
                <Forward className="size-5 text-muted-foreground" aria-hidden />
              ) : undefined
            }
          />

          {/* Owner sees the editable configuration; an admin viewing someone
              else's address gets a read-only summary of the same settings. */}
          {!isOwner ? (
            <div className="rounded-lg border border-border bg-card">
              <div className="flex flex-col gap-0.5 px-5 py-4">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Mode
                </span>
                <span className="text-sm font-medium">
                  {MODE_DESCRIPTIONS[persistedMode].label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {MODE_DESCRIPTIONS[persistedMode].help}
                </span>
              </div>
              <div className="border-t border-border/60 px-5 py-4 text-sm">
                {persistedMode === 'ALIAS' ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Forward className="size-4 shrink-0" aria-hidden />
                    <span className="font-mono break-all text-foreground">
                      {data.address.redirect ?? '—'}
                    </span>
                  </div>
                ) : persistedMode === 'CUSTOM_NWC' ? (
                  <div className="flex items-center gap-2">
                    <Wallet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="text-foreground">
                      {boundWallet ? boundWallet.name : 'No wallet linked'}
                    </span>
                  </div>
                ) : persistedMode === 'DEFAULT_NWC' ? (
                  <div className="flex items-center gap-2">
                    <Wallet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="text-foreground">
                      {defaultWallet ? `${defaultWallet.name} (primary)` : 'No primary wallet'}
                    </span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    Address is disabled and rejects payments.
                  </span>
                )}
              </div>
            </div>
          ) : (
          <Collapsible
            open={modeOpen}
            onOpenChange={setModeOpen}
            className="rounded-lg border border-border bg-card"
            id="address-mode-settings"
          >
            <CollapsibleTrigger
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Mode
                </span>
                <span className="truncate text-sm font-medium">
                  {MODE_DESCRIPTIONS[data.address.mode].label}
                  {data.address.mode === 'ALIAS' && data.address.redirect && (
                    <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                      → {data.address.redirect}
                    </span>
                  )}
                </span>
              </div>
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform',
                  modeOpen && 'rotate-180',
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border/60">
              <form onSubmit={handleModeSubmit} className="flex flex-col gap-4 p-5">
                <p className="text-xs text-muted-foreground">
                  Pick what happens when someone sends to {fullAddress}.
                </p>

                <RadioGroup
                  value={mode}
                  onValueChange={value => setMode(value as LightningAddressMode)}
                  disabled={saving}
                  className="grid gap-2"
                >
                  {modeOptions.map(option => {
                    const isActive = mode === option
                    return (
                      <Label
                        key={option}
                        htmlFor={`mode-${option}`}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-md border border-input p-3 transition-colors',
                          isActive && 'border-primary bg-primary/5',
                        )}
                      >
                        <RadioGroupItem
                          id={`mode-${option}`}
                          value={option}
                          className="mt-0.5"
                        />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {MODE_DESCRIPTIONS[option].label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {MODE_DESCRIPTIONS[option].help}
                          </span>
                        </div>
                      </Label>
                    )
                  })}
                </RadioGroup>

            {mode === 'ALIAS' && (
              <div className="space-y-2">
                <Label htmlFor="redirect">Redirect to</Label>
                <Input
                  ref={redirectInputRef}
                  id="redirect"
                  placeholder="someone@example.com"
                  value={redirect}
                  disabled={saving}
                  onChange={e => setRedirect(e.target.value.toLowerCase())}
                  className={cn(aliasInvalid && 'border-destructive')}
                />
                {aliasInvalid && (
                  <p className="text-xs text-destructive">
                    Enter a valid lightning address.
                  </p>
                )}
              </div>
            )}

            {mode === 'CUSTOM_NWC' && (
              <div className="space-y-4">
                {data.wallets.length > 0 ? (
                  <div className="space-y-2">
                    <Label htmlFor="remote-wallet">Use wallet</Label>
                    {data.address.isPrimary && (
                      <p className="text-xs text-muted-foreground">
                        The selected wallet becomes the account primary wallet.
                      </p>
                    )}
                    <Select
                      value={remoteWalletId}
                      onValueChange={handleWalletSelect}
                      disabled={saving}
                    >
                      <SelectTrigger id="remote-wallet">
                        <SelectValue placeholder="Pick a wallet" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CONNECT_NEW_WALLET_VALUE}>
                          <span className="flex items-center gap-2">
                            <Plus className="size-3.5 text-muted-foreground" />
                            <span>Connect new wallet</span>
                          </span>
                        </SelectItem>
                        <SelectSeparator />
                        {data.wallets.map((w: WalletRemoteWalletSummary) => (
                          <SelectItem key={w.id} value={w.id} disabled={w.status === 'DISABLED'}>
                            {w.name}
                            {w.isDefault && ' (primary)'}
                            {w.status === 'DISABLED' && ' — disabled'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {customMissing && (
                      <p className="text-xs text-destructive">
                        Pick a wallet to continue.
                      </p>
                    )}
                  </div>
                ) : (
                  // No wallets yet \u2014 wallets are created on the Remote Wallets
                  // page, so point the user there instead of an inline form.
                  <p className="text-xs text-muted-foreground">
                    You don't have any wallets yet.{' '}
                    <Link href="/admin/remote-wallets" className="underline">
                      Add one on the Remote Wallets page
                    </Link>{' '}
                    first.
                  </p>
                )}
              </div>
            )}

                {mode === 'DEFAULT_NWC' && (
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    {defaultWallet ? (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                            <Wallet className="size-4 text-primary" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium">Primary wallet</p>
                            <Link
                              href={`/admin/remote-wallets#wallet-${defaultWallet.id}`}
                              className="block truncate text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                            >
                              {defaultWallet.name}
                            </Link>
                          </div>
                        </div>
                        <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5">
                          <Link href={`/admin/remote-wallets#wallet-${defaultWallet.id}`}>
                            View wallet
                            <ExternalLink className="size-3.5" aria-hidden />
                          </Link>
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            {data.wallets.length > 0
                              ? 'No primary wallet selected'
                              : 'No remote wallet linked'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {data.wallets.length > 0
                              ? 'Bind your primary address to a wallet to use this mode.'
                              : 'Link a Remote Wallet before using primary wallet mode.'}
                          </p>
                        </div>
                        <Button asChild variant="theme" size="sm" className="shrink-0 gap-1.5">
                          <Link href="/admin/remote-wallets">
                            {data.wallets.length > 0 ? 'Use for primary address' : 'Link Remote Wallets'}
                            <ExternalLink className="size-3.5" aria-hidden />
                          </Link>
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Save/Cancel live inside the collapsible — once the user
                    expands Mode and makes changes, the actions are right
                    there with the form; the rest of the page stays calm.
                    Cancel reverts local form state back to the loaded
                    baseline and collapses, so re-opening shows a clean
                    form instead of stale uncommitted edits. */}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => {
                      setMode(data.address.mode)
                      setRedirect(data.address.redirect ?? '')
                      setRemoteWalletId(data.address.remoteWalletId ?? '')
                      setModeOpen(false)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="theme" disabled={saveDisabled}>
                    {saving && <Spinner size={16} data-icon="inline-start" />}
                    Save
                  </Button>
                </div>
              </form>
            </CollapsibleContent>
          </Collapsible>
          )}

          {/* Invoices and the delete danger zone are owner-only: the invoices
              feed is served by an owner-scoped route, and an admin's read-only
              view must not mutate another user's address. */}
          {isOwner && (
          <>
          {/* Invoices are the authoritative per-address activity feed —
              they're minted by our own LUD-16 cb route with the username
              stamped on the metadata, so they filter cleanly by address.
              NWC `list_transactions` can't give us per-address scoping
              and is blocked by several wallet providers anyway. */}
          <AddressInvoicesCard username={username} />

          {/* Danger zone — deleting an address is irreversible, so it's
              isolated at the bottom behind a destructive-tinted card and a
              confirm dialog. Mirrors the card detail page convention. */}
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-base text-destructive">
                Danger zone
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Permanently delete {fullAddress}. This action cannot be undone,
                and payments sent to it will no longer be received.
              </p>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={() => setDeleteOpen(true)}
                className="shrink-0"
              >
                <Trash2 className="mr-2 size-4" />
                Delete address
              </Button>
            </CardContent>
          </Card>

          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {fullAddress}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. The address will be permanently
                  removed and can no longer receive payments.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting}
                  onClick={event => {
                    // Keep the dialog mounted through the async delete so its
                    // disabled/spinner state is visible; close + navigate run
                    // inside handleDelete once the request resolves.
                    event.preventDefault()
                    handleDelete()
                  }}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  {deleting && <Spinner size={16} className="mr-2" />}
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          </>
          )}
        </div>
        )
      })()}

      <CreateRemoteWalletDialog
        open={createWalletOpen}
        onOpenChange={setCreateWalletOpen}
        onCreated={handleWalletCreated}
        showTrigger={false}
      />

      <Dialog
        open={aliasProbeOpen}
        onOpenChange={open => {
          if (aliasProbePhase === 'checking' || aliasProbePhase === 'saving') {
            return
          }
          setAliasProbeOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Validate alias address</DialogTitle>
            <DialogDescription>
              Checking {aliasProbeAddress || 'the alias target'} before saving
              the redirect.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {ALIAS_PROBE_CHECKS.map(checkMeta => {
              const check = aliasProbeChecks[checkMeta.key]
              return (
                <div
                  key={checkMeta.key}
                  className="rounded-md border border-border bg-card p-3"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                      <AliasProbeStatusIcon status={check.status} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">{checkMeta.label}</p>
                        <span
                          className={cn(
                            'text-xs text-muted-foreground',
                            check.status === 'valid' && 'text-primary',
                            check.status === 'invalid' && 'text-destructive'
                          )}
                        >
                          {check.status === 'pending'
                            ? 'Checking'
                            : check.status === 'valid'
                              ? 'Passed'
                              : 'Needs attention'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {check.message || checkMeta.description}
                      </p>
                      <Progress
                        value={aliasProbeProgressValue(check.status)}
                        aria-label={`${checkMeta.label} validation progress`}
                        className={cn(
                          'mt-3 h-1.5',
                          check.status === 'pending' && '[&>div]:animate-pulse',
                          check.status === 'invalid' && '[&>div]:bg-destructive'
                        )}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {aliasProbePhase === 'blocked' && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <p className="text-destructive">
                LUD-16 did not pass, so this alias cannot be saved.
              </p>
            </div>
          )}

          {aliasProbePhase === 'warnings' && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                {aliasProbeHasOptionalWarnings
                  ? 'LUD-16 passed. The optional capability warnings above will not block forwarding.'
                  : 'Validation passed, but the save did not complete. You can try again.'}
              </p>
            </div>
          )}

          {aliasProbePhase === 'saving' && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <Spinner size={16} aria-hidden />
              Saving alias redirect…
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {aliasProbePhase === 'blocked' && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAliasProbeOpen(false)}
              >
                Close
              </Button>
            )}
            {aliasProbePhase === 'warnings' && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => setAliasProbeOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="theme"
                  disabled={saving}
                  onClick={saveAfterAliasProbeWarnings}
                >
                  {saving && <Spinner size={16} data-icon="inline-start" />}
                  Save alias
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
