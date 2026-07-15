'use client'

import React, { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, Forward, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
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
import {
  FIXED_PRICE_CURRENCY_CATALOG,
  estimateFixedPriceSats,
  formatFixedPrice,
  isValidFixedPriceAmount,
  saveFixedPrice,
  useFixedPrice,
} from '@/lib/client/fixed-price'
import { useSettings } from '@/lib/client/hooks/use-settings'
import {
  useMyAddress,
  useAddressMutations,
  type LightningAddressMode,
  type WalletRemoteWalletSummary,
} from '@/lib/client/hooks/use-wallet-addresses'
import { useYadioRates } from '@/lib/client/use-yadio-ticker'
import { isLightningAddress } from '@/lib/ln-address'
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
  DEFAULT_NWC: { label: 'Default wallet', help: 'Use your primary wallet (set in Remote Wallets).' },
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
  const { username } = use(params)
  const { data: settings } = useSettings()
  const { data, loading, refetch } = useMyAddress(username)
  const { updateAddress, updating } = useAddressMutations()
  const { rates, loading: ratesLoading, error: ratesError } = useYadioRates()
  const savedFixedPrice = useFixedPrice(username)

  const [mode, setMode] = useState<LightningAddressMode>('DEFAULT_NWC')
  const [redirect, setRedirect] = useState('')
  const [remoteWalletId, setRemoteWalletId] = useState<string>('')
  const [fixedPriceEnabled, setFixedPriceEnabled] = useState(false)
  const [fixedPriceAmount, setFixedPriceAmount] = useState('')
  const [fixedPriceCurrency, setFixedPriceCurrency] = useState('SAT')
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
    setFixedPriceEnabled(Boolean(savedFixedPrice))
    setFixedPriceAmount(savedFixedPrice?.amount ?? '')
    setFixedPriceCurrency(savedFixedPrice?.currency ?? 'SAT')
  }, [savedFixedPrice, username])

  const domain = settings?.domain || 'your-domain'
  const fullAddress = `${username}@${domain}`
  const aliasInvalid = mode === 'ALIAS' && redirect.length > 0 && !isLightningAddress(redirect)
  const aliasMissing = mode === 'ALIAS' && redirect.length === 0
  const customMissing = mode === 'CUSTOM_NWC' && !remoteWalletId
  const fixedPriceAmountValue = fixedPriceAmount.trim()
  const fixedPriceInvalid =
    fixedPriceEnabled &&
    !isValidFixedPriceAmount(fixedPriceAmountValue, fixedPriceCurrency)
  const fixedPricePreviewSats = fixedPriceEnabled
    ? estimateFixedPriceSats(fixedPriceAmountValue, fixedPriceCurrency, rates)
    : null
  const fixedPriceRateMissing =
    fixedPriceEnabled &&
    fixedPriceCurrency !== 'SAT' &&
    fixedPriceAmountValue.length > 0 &&
    !fixedPriceInvalid &&
    fixedPricePreviewSats === null

  // Dirty check: compare the current form state to the last-saved baseline.
  // `redirect` and `remoteWalletId` are normalised to empty string on load
  // (see the hydration effect above), and the server returns them as `null`
  // when unset, so both sides collapse "empty" to the same sentinel here.
  // Without this the Save button was always enabled as long as inputs were
  // valid, even when the user hadn't touched anything.
  const baseline = data?.address
  const nextFixedPrice = fixedPriceEnabled
    ? { amount: fixedPriceAmountValue, currency: fixedPriceCurrency }
    : null
  const baselineFixedPrice = savedFixedPrice
  const fixedPriceDirty =
    !!baseline &&
    ((baselineFixedPrice === null) !== (nextFixedPrice === null) ||
      (baselineFixedPrice !== null &&
        nextFixedPrice !== null &&
        (baselineFixedPrice.amount !== nextFixedPrice.amount ||
          baselineFixedPrice.currency !== nextFixedPrice.currency)))
  const addressDirty =
    !!baseline &&
    (mode !== baseline.mode ||
      (redirect ?? '') !== (baseline.redirect ?? '') ||
      (remoteWalletId ?? '') !== (baseline.remoteWalletId ?? ''))
  const isDirty = addressDirty || fixedPriceDirty

  const saveDisabled =
    saving ||
    updating ||
    !isDirty ||
    aliasInvalid ||
    aliasMissing ||
    customMissing ||
    fixedPriceInvalid

  async function handleSave() {
    setSaving(true)
    try {
      if (addressDirty) {
        await updateAddress(username, {
          mode,
          redirect: mode === 'ALIAS' ? redirect : null,
          remoteWalletId: mode === 'CUSTOM_NWC' ? remoteWalletId : null,
        })
        // Wait for the refetch to land too — this is what prevents the
        // Save button from briefly un-disabling between "mutation done"
        // and "form reset to clean".
        await refetch()
        trackEvent(AnalyticsEvent.ADDRESS_MODE_CHANGED, { mode })
      }
      if (fixedPriceDirty) saveFixedPrice(username, nextFixedPrice)
      setModeOpen(false)
      toast.success(addressDirty ? 'Saved' : 'Fixed price saved on this device')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title={fullAddress}
        subtitle="Configure how this address handles incoming payments."
        type="subpage"
        onBack={() => router.push('/admin/addresses')}
      />

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size={24} />
        </div>
      ) : !data ? (
        <div className="space-y-3 py-12 text-center">
          <p className="text-muted-foreground">Address not found.</p>
          <Button variant="secondary" onClick={() => router.push('/admin/addresses')}>
            Back to addresses
          </Button>
        </div>
      ) : (() => {
        // `effectiveConnectionString` is resolved server-side by
        // `resolvePaymentRoute`, so it already handles the full fallback
        // chain (CUSTOM_NWC link → DEFAULT_NWC primary → legacy
        // `User.nwc` for un-migrated accounts) without duplicating the
        // logic here. Null for IDLE / ALIAS / unconfigured — the widgets
        // below render an empty state in those cases.
        const persistedMode = data.address.mode
        const defaultWallet = data.wallets.find(w => w.isDefault) ?? null

        const emptyReason =
          persistedMode === 'IDLE'
            ? 'This address is disabled.'
          : persistedMode === 'ALIAS'
            ? `Forwards to ${data.address.redirect ?? 'another address'}.`
          : persistedMode === 'CUSTOM_NWC'
            ? 'No wallet is linked to this address yet.'
          : 'Set a primary wallet to enable payments.'

        return (
        <div className="space-y-6 px-4 py-6 sm:px-6">
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

          {/* Configuration lives in a collapsed section — the summary row
              shows the current mode at a glance; the full picker + inputs
              appear on click. Controlled open state so a successful Save
              re-collapses it. */}
          <Collapsible
            open={modeOpen}
            onOpenChange={setModeOpen}
            className="rounded-lg border border-border bg-card"
          >
            <CollapsibleTrigger
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Mode
                </span>
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="truncate">
                    {MODE_DESCRIPTIONS[data.address.mode].label}
                    {data.address.mode === 'ALIAS' && data.address.redirect && (
                      <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                        → {data.address.redirect}
                      </span>
                    )}
                  </span>
                  {savedFixedPrice && (
                    <Badge variant="secondary" className="gap-1">
                      <Tag className="size-3" aria-hidden />
                      {formatFixedPrice(savedFixedPrice)}
                    </Badge>
                  )}
                </div>
              </div>
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform',
                  modeOpen && 'rotate-180',
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border/60">
              <div className="space-y-4 p-5">
                <p className="text-xs text-muted-foreground">
                  Pick what happens when someone sends to {fullAddress}.
                </p>

                <RadioGroup
                  value={mode}
                  onValueChange={value => setMode(value as LightningAddressMode)}
                  disabled={saving}
                  className="grid gap-2"
                >
                  {(Object.keys(MODE_DESCRIPTIONS) as LightningAddressMode[]).map(option => {
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
                    <Select
                      value={remoteWalletId}
                      onValueChange={setRemoteWalletId}
                      disabled={saving}
                    >
                      <SelectTrigger id="remote-wallet">
                        <SelectValue placeholder="Pick a wallet" />
                      </SelectTrigger>
                      <SelectContent>
                        {data.wallets.map((w: WalletRemoteWalletSummary) => (
                          <SelectItem key={w.id} value={w.id} disabled={w.status === 'DISABLED'}>
                            {w.name}
                            {w.isDefault && ' (primary)'}
                            {w.status === 'DISABLED' && ' \u2014 disabled'}
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
                    You don\u2019t have any wallets yet.{' '}
                    <Link href="/admin/remote-wallets" className="underline">
                      Add one on the Remote Wallets page
                    </Link>{' '}
                    first.
                  </p>
                )}
              </div>
            )}

                {mode === 'DEFAULT_NWC' && (
                  <p className="text-xs text-muted-foreground">
                    {defaultWallet
                      ? `Will use your primary wallet (${defaultWallet.name}).`
                      : 'You haven\u2019t set a primary wallet yet.'}
                  </p>
                )}

                <div className="flex flex-col gap-4 rounded-md border border-border/70 bg-background/60 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor="fixed-price-enabled">Fixed price</Label>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Keep a price reference for this address on this device.
                      </p>
                    </div>
                    <Switch
                      id="fixed-price-enabled"
                      checked={fixedPriceEnabled}
                      disabled={saving}
                      onCheckedChange={setFixedPriceEnabled}
                    />
                  </div>

                  {fixedPriceEnabled && (
                    <div className="flex flex-col gap-3">
                      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="fixed-price-amount">Amount</Label>
                          <Input
                            id="fixed-price-amount"
                            inputMode={fixedPriceCurrency === 'SAT' ? 'numeric' : 'decimal'}
                            placeholder={fixedPriceCurrency === 'SAT' ? '2500' : '10.00'}
                            value={fixedPriceAmount}
                            disabled={saving}
                            aria-invalid={fixedPriceInvalid}
                            onChange={e => setFixedPriceAmount(e.target.value.replace(',', '.'))}
                            className={cn(fixedPriceInvalid && 'border-destructive')}
                          />
                        </div>

                        <div className="flex flex-col gap-2">
                          <Label htmlFor="fixed-price-currency">Currency</Label>
                          <Select
                            value={fixedPriceCurrency}
                            onValueChange={setFixedPriceCurrency}
                            disabled={saving}
                          >
                            <SelectTrigger id="fixed-price-currency">
                              <SelectValue placeholder="Currency" />
                            </SelectTrigger>
                            <SelectContent>
                              {FIXED_PRICE_CURRENCY_CATALOG.map(currency => (
                                <SelectItem key={currency.code} value={currency.code}>
                                  {currency.code === 'SAT'
                                    ? 'SAT - Satoshi'
                                    : `${currency.code} - ${currency.name}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {fixedPriceInvalid ? (
                        <p className="text-xs text-destructive">
                          {fixedPriceCurrency === 'SAT'
                            ? 'Enter a positive whole number of sats.'
                            : 'Enter a positive fiat amount with up to 8 decimals.'}
                        </p>
                      ) : fixedPricePreviewSats !== null ? (
                        <p className="text-xs text-muted-foreground">
                          Current reference:{' '}
                          <span className="font-medium text-foreground">
                            {fixedPricePreviewSats.toLocaleString()} sats
                          </span>
                          {fixedPriceCurrency === 'SAT' ? '.' : ' at the current Yadio rate.'}
                        </p>
                      ) : fixedPriceRateMissing ? (
                        <p className="text-xs text-muted-foreground">
                          {ratesLoading
                            ? 'Fetching Yadio rate...'
                            : ratesError
                              ? 'Yadio preview unavailable.'
                              : `Yadio has no usable ${fixedPriceCurrency} rate right now.`}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Save/Cancel live inside the collapsible — once the user
                    expands Mode and makes changes, the actions are right
                    there with the form; the rest of the page stays calm.
                    Cancel reverts local form state back to the loaded
                    baseline and collapses, so re-opening shows a clean
                    form instead of stale uncommitted edits. */}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    variant="secondary"
                    disabled={saving}
                    onClick={() => {
                      setMode(data.address.mode)
                      setRedirect(data.address.redirect ?? '')
                      setRemoteWalletId(data.address.remoteWalletId ?? '')
                      setFixedPriceEnabled(Boolean(savedFixedPrice))
                      setFixedPriceAmount(savedFixedPrice?.amount ?? '')
                      setFixedPriceCurrency(savedFixedPrice?.currency ?? 'SAT')
                      setModeOpen(false)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="theme" disabled={saveDisabled} onClick={handleSave}>
                    {saving && <Spinner size={16} className="mr-2" />}
                    Save
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Invoices are the authoritative per-address activity feed —
              they're minted by our own LUD-16 cb route with the username
              stamped on the metadata, so they filter cleanly by address.
              NWC `list_transactions` can't give us per-address scoping
              and is blocked by several wallet providers anyway. */}
          <AddressInvoicesCard username={username} />
        </div>
        )
      })()}
    </div>
  )
}
