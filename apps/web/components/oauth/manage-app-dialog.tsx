'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useMutation } from '@/lib/client/hooks/use-api'
import { useRemoteWallets } from '@/lib/client/hooks/use-remote-wallets'
import {
  GRANTS_PATH,
  type OAuthGrantSummary,
  type OAuthGrantUpdate
} from '@/lib/client/oauth-api'
import {
  DEFAULT_SPEND_LIMIT_SATS,
  MAX_SPEND_LIMIT_SATS,
  OAUTH_SCOPES,
  type OAuthScope
} from '@/lib/oauth/constants'
import { cn } from '@/lib/utils'
import { ScopeOptions } from '@/components/oauth/scope-options'
import {
  SpendLimitField,
  parseSpendLimit,
  spendLimitValid
} from '@/components/oauth/spend-limit-field'
import {
  WalletAccessPicker,
  walletSelectionValid,
  type WalletSelection
} from '@/components/oauth/wallet-access-picker'

/**
 * Edits what a connected app may do — permissions, daily spend limit and the
 * wallets it can use — without reconnecting it. Saved changes apply on the
 * app's next call.
 */
export function ManageAppDialog({
  grant,
  onOpenChange
}: {
  grant: OAuthGrantSummary | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={!!grant} onOpenChange={onOpenChange}>
      {/* Wide only while the wallets column is shown (spend ticked). */}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg lg:has-[[data-wallets-column]]:max-w-4xl">
        {/* Keyed so each opening starts from that grant's saved values. */}
        {grant && (
          <ManageAppForm
            key={grant.id}
            grant={grant}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ManageAppForm({
  grant,
  onDone
}: {
  grant: OAuthGrantSummary
  onDone: () => void
}) {
  const walletList = useRemoteWallets()
  const wallets = walletList.data ?? []
  const save = useMutation<OAuthGrantUpdate, { grant: OAuthGrantSummary }>([
    GRANTS_PATH
  ])
  const [selected, setSelected] = useState<OAuthScope[]>(grant.scopes)
  const [limitText, setLimitText] = useState(
    String(grant.spendLimitSats ?? DEFAULT_SPEND_LIMIT_SATS)
  )
  const [walletSelection, setWalletSelection] = useState<WalletSelection>(
    grant.wallets?.map(w => w.id) ?? null
  )

  const readLocked = selected.includes('write') || selected.includes('spend')
  const chosen = OAUTH_SCOPES.filter(
    scope => selected.includes(scope) || (scope === 'read' && readLocked)
  )
  const spend = chosen.includes('spend')
  const limit = parseSpendLimit(limitText)
  const limitValid = spendLimitValid(limitText, MAX_SPEND_LIMIT_SATS)
  const canSave =
    chosen.length > 0 &&
    (!spend || (limitValid && walletSelectionValid(walletSelection))) &&
    !save.loading

  function toggle(scope: OAuthScope, checked: boolean) {
    setSelected(prev =>
      checked ? [...prev, scope] : prev.filter(s => s !== scope)
    )
  }

  async function handleSave() {
    try {
      await save.mutate(
        'patch',
        `${GRANTS_PATH}/${encodeURIComponent(grant.id)}`,
        {
          scopes: chosen,
          ...(spend ? { spendLimitSats: limit } : {}),
          walletIds: spend ? walletSelection : null
        }
      )
      toast.success(`Access updated for ${grant.clientName}`)
      onDone()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not update access'
      )
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Manage <bdi>{grant.clientName}</bdi>
        </DialogTitle>
        <DialogDescription>
          Choose what this app may do and which wallets it can use. Changes
          apply on its next request; it stays connected.
        </DialogDescription>
      </DialogHeader>

      {/* Side by side where there is room: what it may do | which wallets. */}
      <div className={cn('grid gap-4', spend && 'lg:grid-cols-2 lg:gap-8')}>
        <div className="flex min-w-0 flex-col gap-4">
          <ScopeOptions
            legend="Permissions"
            scopes={OAUTH_SCOPES}
            chosen={chosen}
            readLocked={readLocked}
            disabled={save.loading}
            onToggle={toggle}
          />

          {spend && (
            <SpendLimitField
              id="manage-spend-limit"
              value={limitText}
              onChange={setLimitText}
              max={MAX_SPEND_LIMIT_SATS}
              disabled={save.loading}
            />
          )}
        </div>

        {spend && (
          <div className="min-w-0" data-wallets-column>
            {walletList.error ? (
              <p role="alert" className="text-sm text-destructive">
                Couldn&apos;t load your wallets: {walletList.error.message}
              </p>
            ) : (
              <WalletAccessPicker
                wallets={wallets}
                loading={walletList.data === null}
                value={walletSelection}
                onChange={setWalletSelection}
                disabled={save.loading}
              />
            )}
          </div>
        )}
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={save.loading}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave || (spend && !!walletList.error)}
        >
          {save.loading && <Spinner size={16} />}
          Save changes
        </Button>
      </DialogFooter>
    </>
  )
}
