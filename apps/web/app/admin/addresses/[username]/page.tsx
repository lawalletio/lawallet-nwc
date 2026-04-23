'use client'

import React, { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Forward } from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
import { InputWithQrScanner } from '@/components/ui/input-with-qr-scanner'
import { BalanceCard } from '@/components/wallet/balance-card'
import { AddressInvoicesCard } from '@/components/wallet/address-invoices-card'
import { useSettings } from '@/lib/client/hooks/use-settings'
import {
  useMyAddress,
  useAddressMutations,
  type LightningAddressMode,
  type WalletNwcConnectionSummary,
} from '@/lib/client/hooks/use-wallet-addresses'
import { isLightningAddress } from '@/lib/ln-address'
import { cn } from '@/lib/utils'

/**
 * Structural check for a Nostr Wallet Connect URI, mirrored from the server
 * Zod schema. Cheap enough to run on every keystroke so we can enable/disable
 * the "Add connection" button without a round-trip.
 */
const NWC_URI_RE = /^nostr\+walletconnect:\/\//i

const MODE_DESCRIPTIONS: Record<
  LightningAddressMode,
  { label: string; help: string }
> = {
  IDLE: { label: 'Idle', help: 'Address is disabled and rejects payments.' },
  ALIAS: { label: 'Alias', help: 'Forward incoming payments to another lightning address.' },
  CUSTOM_NWC: { label: 'Custom NWC', help: 'Receive via a specific NWC connection.' },
  DEFAULT_NWC: { label: 'Default NWC', help: 'Use your primary NWC connection (set in NWC settings).' },
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
  const {
    updateAddress,
    updating,
    createNwcConnection,
    creatingConnection,
  } = useAddressMutations()

  const [mode, setMode] = useState<LightningAddressMode>('DEFAULT_NWC')
  const [redirect, setRedirect] = useState('')
  const [nwcConnectionId, setNwcConnectionId] = useState<string>('')
  // Inline "new connection" state — only relevant when mode = CUSTOM_NWC.
  // Kept separate from the existing-connection picker so users with zero
  // connections still see a usable form, and users with some still get a
  // clear path to add another.
  const [newConnectionUri, setNewConnectionUri] = useState('')
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
    setNwcConnectionId(data.address.nwcConnectionId ?? '')
  }, [data, updatedAt])

  const domain = settings?.domain || 'your-domain'
  const fullAddress = `${username}@${domain}`
  const aliasInvalid = mode === 'ALIAS' && redirect.length > 0 && !isLightningAddress(redirect)
  const aliasMissing = mode === 'ALIAS' && redirect.length === 0
  const customMissing = mode === 'CUSTOM_NWC' && !nwcConnectionId
  const newUriInvalid =
    newConnectionUri.trim().length > 0 && !NWC_URI_RE.test(newConnectionUri.trim())
  const canAddConnection =
    !saving &&
    !creatingConnection &&
    newConnectionUri.trim().length > 0 &&
    !newUriInvalid

  // Dirty check: compare the current form state to the last-saved baseline.
  // `redirect` and `nwcConnectionId` are normalised to empty string on load
  // (see the hydration effect above), and the server returns them as `null`
  // when unset, so both sides collapse "empty" to the same sentinel here.
  // Without this the Save button was always enabled as long as inputs were
  // valid, even when the user hadn't touched anything.
  const baseline = data?.address
  const isDirty =
    !!baseline &&
    (mode !== baseline.mode ||
      (redirect ?? '') !== (baseline.redirect ?? '') ||
      (nwcConnectionId ?? '') !== (baseline.nwcConnectionId ?? ''))

  const saveDisabled =
    saving || updating || !isDirty || aliasInvalid || aliasMissing || customMissing

  /**
   * Create a new NWCConnection for the caller and select it as the current
   * address's connection. Does NOT persist the address update itself —
   * user still hits Save to finalise the address row.
   */
  async function handleAddConnection() {
    const connectionString = newConnectionUri.trim()
    if (!connectionString || !NWC_URI_RE.test(connectionString)) {
      toast.error('Paste a valid nostr+walletconnect:// URI')
      return
    }
    try {
      const created = await createNwcConnection({ connectionString })
      setNwcConnectionId(created.id)
      setNewConnectionUri('')
      toast.success('NWC connection added')
      // Refetch so the picker shows the new connection immediately.
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add connection')
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateAddress(username, {
        mode,
        redirect: mode === 'ALIAS' ? redirect : null,
        nwcConnectionId: mode === 'CUSTOM_NWC' ? nwcConnectionId : null,
      })
      // Wait for the refetch to land too — this is what prevents the
      // Save button from briefly un-disabling between "mutation done"
      // and "form reset to clean".
      await refetch()
      setModeOpen(false)
      toast.success('Saved')
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
        const primaryConnection = data.connections.find(c => c.isPrimary) ?? null

        const emptyReason =
          persistedMode === 'IDLE'
            ? 'This address is disabled.'
          : persistedMode === 'ALIAS'
            ? `Forwards to ${data.address.redirect ?? 'another address'}.`
          : persistedMode === 'CUSTOM_NWC'
            ? 'No NWC connection is linked to this address yet.'
          : 'Set up a primary NWC connection to enable payments.'

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
                {/* Existing-connection picker. Only shown when the user has
                    at least one connection. With zero connections the inline
                    add-new form below is the only path, which is the common
                    case on first-time setup. */}
                {data.connections.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="nwc-connection">Use existing connection</Label>
                    <Select
                      value={nwcConnectionId}
                      onValueChange={setNwcConnectionId}
                      disabled={saving}
                    >
                      <SelectTrigger id="nwc-connection">
                        <SelectValue placeholder="Pick a connection" />
                      </SelectTrigger>
                      <SelectContent>
                        {data.connections.map((c: WalletNwcConnectionSummary) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.mode === 'SEND_RECEIVE' ? 'Send & Receive' : 'Receive'}
                            {c.isPrimary && ' (primary)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Inline "add new connection" form. Always visible in
                    CUSTOM_NWC mode; on success it auto-selects the new
                    connection so the user just needs to hit Save. */}
                <div className="space-y-2">
                  <Label htmlFor="new-nwc-uri">
                    {data.connections.length > 0
                      ? 'Or add a new connection'
                      : 'NWC connection URI'}
                  </Label>
                  <div className="flex items-center gap-2">
                    <InputWithQrScanner
                      id="new-nwc-uri"
                      placeholder="nostr+walletconnect://..."
                      value={newConnectionUri}
                      onChange={setNewConnectionUri}
                      onScanError={err => toast.error(err)}
                      scanLabel="Scan NWC QR code"
                      containerClassName="flex-1"
                      className={cn('font-mono text-xs', newUriInvalid && 'border-destructive')}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      disabled={saving || creatingConnection}
                    />
                    <Button
                      type="button"
                      onClick={handleAddConnection}
                      disabled={!canAddConnection}
                    >
                      {creatingConnection && <Spinner size={16} className="mr-2" />}
                      Add
                    </Button>
                  </div>
                  {newUriInvalid ? (
                    <p className="text-xs text-destructive">
                      Must start with <code>nostr+walletconnect://</code>.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Paste a connection URI or scan a QR code from your wallet.
                    </p>
                  )}
                </div>

                {customMissing && data.connections.length > 0 && (
                  <p className="text-xs text-destructive">
                    Pick a connection or add a new one to continue.
                  </p>
                )}
              </div>
            )}

                {mode === 'DEFAULT_NWC' && (
                  <p className="text-xs text-muted-foreground">
                    {primaryConnection
                      ? `Will use your primary connection (${
                          primaryConnection.mode === 'SEND_RECEIVE'
                            ? 'Send & Receive'
                            : 'Receive'
                        }).`
                      : 'You haven\u2019t set up a primary NWC connection yet.'}
                  </p>
                )}

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
                      setNwcConnectionId(data.address.nwcConnectionId ?? '')
                      setNewConnectionUri('')
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
