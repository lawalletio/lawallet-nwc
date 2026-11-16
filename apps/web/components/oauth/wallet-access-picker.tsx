'use client'

import Image from 'next/image'
import { Layers, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Fieldset, FieldsetLegend } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useRemoteWalletBalance,
  type RemoteWalletData
} from '@/lib/client/hooks/use-remote-wallets'
import { cn } from '@/lib/utils'

/** Wallet access of a connection: null for every wallet, else the chosen ids. */
export type WalletSelection = string[] | null

/**
 * Least privilege by default: just the primary wallet. With no wallet at all
 * there is nothing to pick, so the app gets the ones added later.
 */
export function defaultWalletSelection(
  wallets: RemoteWalletData[]
): WalletSelection {
  const primary = wallets.find(w => w.isDefault) ?? wallets[0]
  return primary ? [primary.id] : null
}

/** Shown under the picker and used to gate Approve / Save. */
export function walletSelectionValid(selection: WalletSelection): boolean {
  return selection === null || selection.length > 0
}

const OPTION =
  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50'

/**
 * Picks which of the account's wallets an MCP connection may use: all of
 * them (including ones added later) or a chosen few. Used by the consent
 * screen and the Connected apps editor.
 */
export function WalletAccessPicker({
  wallets,
  loading,
  value,
  onChange,
  disabled
}: {
  wallets: RemoteWalletData[]
  loading: boolean
  value: WalletSelection
  onChange: (value: WalletSelection) => void
  disabled?: boolean
}) {
  const mode = value === null ? 'all' : 'selected'
  const selected = new Set(value ?? [])

  function setMode(next: string) {
    if (next === 'all') onChange(null)
    else onChange(defaultWalletSelection(wallets) ?? [])
  }

  function toggle(id: string, checked: boolean) {
    const ids = wallets
      .map(w => w.id)
      .filter(wid => (wid === id ? checked : selected.has(wid)))
    onChange(ids)
  }

  if (loading && wallets.length === 0) {
    return (
      <Fieldset className="gap-2">
        <FieldsetLegend className="mb-2 text-sm">
          Wallets it can use
        </FieldsetLegend>
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </Fieldset>
    )
  }

  if (wallets.length === 0) {
    return (
      <Fieldset className="gap-2">
        <FieldsetLegend className="mb-2 text-sm">
          Wallets it can use
        </FieldsetLegend>
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          You have no wallets yet. The app will be able to use the wallets you
          add later; you can narrow this under Connected apps.
        </p>
      </Fieldset>
    )
  }

  return (
    <Fieldset className="gap-2">
      <FieldsetLegend className="mb-2 text-sm">
        Wallets it can use
      </FieldsetLegend>
      <RadioGroup
        value={mode}
        onValueChange={setMode}
        disabled={disabled}
        aria-label="Wallet access"
        className="grid-cols-1 sm:grid-cols-2"
      >
        <label
          className={cn(
            OPTION,
            mode === 'selected'
              ? 'border-primary bg-accent'
              : 'border-border bg-background'
          )}
        >
          <RadioGroupItem
            value="selected"
            className="mt-0.5"
            aria-label="Only selected wallets"
          />
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Wallet className="size-3.5" />
              Only selected
            </span>
            <span className="text-xs text-muted-foreground">
              Pick the wallets below.
            </span>
          </span>
        </label>
        <label
          className={cn(
            OPTION,
            mode === 'all'
              ? 'border-primary bg-accent'
              : 'border-border bg-background'
          )}
        >
          <RadioGroupItem
            value="all"
            className="mt-0.5"
            aria-label="All wallets"
          />
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Layers className="size-3.5" />
              All wallets
            </span>
            <span className="text-xs text-muted-foreground">
              Includes wallets you add later.
            </span>
          </span>
        </label>
      </RadioGroup>

      {/* Nothing to pick when every wallet is included. */}
      {mode === 'selected' && (
        <ul
          aria-label="Your wallets"
          className="flex flex-col overflow-hidden rounded-lg border"
        >
          {wallets.map(wallet => (
            <WalletRow
              key={wallet.id}
              wallet={wallet}
              checked={selected.has(wallet.id)}
              disabled={disabled}
              onCheckedChange={checked => toggle(wallet.id, checked)}
            />
          ))}
        </ul>
      )}
      <p
        aria-live="polite"
        className={cn(
          'text-xs',
          walletSelectionValid(value)
            ? 'text-muted-foreground'
            : 'text-destructive'
        )}
      >
        {value === null
          ? `The app can use all ${wallets.length} of your wallets, and any you add later.`
          : value.length === 0
            ? 'Select at least one wallet.'
            : `The app can only see and use ${value.length} of your ${wallets.length} wallets. The others stay invisible to it.`}
      </p>
    </Fieldset>
  )
}

/**
 * The wallet's kind at a glance: the LNCurl pixel mark or the NWC plug, the
 * same marks as the Android wallet. The NWC artwork has more padding, so it
 * is drawn larger to match visually.
 */
function WalletTypeIcon({ lncurl }: { lncurl: boolean }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
      <Image
        src={lncurl ? '/logos/wallet-lncurl.svg' : '/logos/wallet-nwc.png'}
        alt={lncurl ? 'LNCurl' : 'NWC'}
        width={32}
        height={32}
        className={lncurl ? 'size-6' : 'size-8'}
      />
    </span>
  )
}

function WalletRow({
  wallet,
  checked,
  disabled,
  onCheckedChange
}: {
  wallet: RemoteWalletData
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const active = wallet.status === 'ACTIVE'
  const { data: balance, loading } = useRemoteWalletBalance(
    active ? wallet.id : null
  )

  return (
    <li className="border-b border-border/60 last:border-b-0">
      <label
        className={cn(
          'flex cursor-pointer items-center gap-3 bg-background px-3 py-2.5 transition-colors hover:bg-accent/50',
          checked && 'bg-accent/60',
          disabled && 'cursor-not-allowed'
        )}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={value => onCheckedChange(value === true)}
          disabled={disabled}
          aria-label={wallet.name}
        />
        <WalletTypeIcon lncurl={wallet.provider === 'lncurl'} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">
            {wallet.name}
          </span>
          {/* The icon shows the kind (NWC or LNCurl); badges only add state. */}
          {(wallet.isDefault || !active) && (
            <span className="flex flex-wrap items-center gap-1">
              {wallet.isDefault && (
                <Badge className="px-1.5 py-0 text-[10px]">Primary</Badge>
              )}
              {!active && (
                <Badge
                  variant="outline"
                  className="px-1.5 py-0 text-[10px] text-muted-foreground"
                >
                  {wallet.status.toLowerCase()}
                </Badge>
              )}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {!active ? null : loading && !balance ? (
            <Skeleton className="h-3.5 w-14" />
          ) : balance && balance.reachable !== false ? (
            <>
              <span className="text-sm font-medium text-foreground">
                {balance.balanceSats.toLocaleString()}
              </span>{' '}
              sats
            </>
          ) : (
            'Offline'
          )}
        </span>
      </label>
    </li>
  )
}
