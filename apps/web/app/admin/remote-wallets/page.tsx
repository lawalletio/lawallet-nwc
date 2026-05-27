'use client'

import React from 'react'
import { Star, Wallet } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { TableSkeleton } from '@/components/admin/skeletons/table-skeleton'
import { CreateRemoteWalletDialog } from '@/components/admin/create-remote-wallet-dialog'
import { RemoteWalletRowActions } from '@/components/admin/remote-wallet-row-actions'
import {
  useRemoteWallets,
  useRemoteWalletBalance,
  type RemoteWalletData,
} from '@/lib/client/hooks/use-remote-wallets'

/**
 * `/admin/remote-wallets` — the signed-in user's external wallets.
 *
 * Like `/admin/addresses`, this lives under `/admin` but the data is
 * per-user (the API scopes everything by the authenticated pubkey), so
 * plain USERs without an admin role still see — and only see — their own
 * wallets here. Cross-user views for admins are a follow-up.
 *
 * First slice covers read-only list + an "Add wallet" CTA. Per-row actions
 * (rename / set default / disable / revoke) and the add dialog land in
 * follow-up commits on this branch.
 */
export default function RemoteWalletsPage() {
  const { data: wallets, loading, error, refetch } = useRemoteWallets()

  return (
    <div className="flex flex-col">
      <AdminTopbar title="Remote Wallets" />

      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Your wallets</h2>
            <p className="text-sm text-muted-foreground">
              External wallets your Lightning addresses and Cards can route
              payments through.
            </p>
          </div>
          <CreateRemoteWalletDialog onCreated={refetch} />
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            Couldn’t load your wallets: {error.message}
          </div>
        ) : loading ? (
          <TableSkeleton rows={3} columns={6} />
        ) : !wallets || wallets.length === 0 ? (
          <EmptyState />
        ) : (
          <WalletsTable wallets={wallets} onChanged={refetch} />
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed py-16 text-center">
      <div className="rounded-full bg-muted p-3">
        <Wallet className="size-6 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium">No wallets yet</p>
        <p className="text-sm text-muted-foreground">
          Add an NWC wallet to start routing payments through your Lightning
          addresses and Cards.
        </p>
      </div>
    </div>
  )
}

const STATUS_VARIANT: Record<
  RemoteWalletData['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  ACTIVE: 'default',
  DISABLED: 'secondary',
  REVOKED: 'outline',
}

function WalletsTable({
  wallets,
  onChanged,
}: {
  wallets: RemoteWalletData[]
  onChanged: () => void
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>Created</TableHead>
            {/* `w-0` keeps the actions cell snug against the right edge —
                the icon button is fixed width, so no need to claim more. */}
            <TableHead className="w-0 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {wallets.map(w => (
            <TableRow key={w.id}>
              <TableCell className="font-medium">
                <span className="flex items-center gap-1.5">
                  {w.name}
                  {w.isDefault && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Star
                            className="size-3.5 shrink-0 fill-current text-amber-400"
                            aria-label="Primary wallet"
                          />
                        </TooltipTrigger>
                        <TooltipContent>Primary wallet</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{w.type}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[w.status]}>{w.status}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <WalletBalanceCell wallet={w} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(w.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <RemoteWalletRowActions wallet={w} onChanged={onChanged} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Live NWC balance for one row. Fetched per-row (not in the list query) so
 * the table renders instantly and balances stream in independently. REVOKED
 * wallets have no live balance, so we skip the fetch and show a dash.
 */
function WalletBalanceCell({ wallet }: { wallet: RemoteWalletData }) {
  const skip = wallet.status === 'REVOKED'
  const { data, loading, error } = useRemoteWalletBalance(skip ? null : wallet.id)

  if (skip) return <span className="text-muted-foreground">—</span>
  if (loading) return <Spinner className="ml-auto size-3.5 text-muted-foreground" />
  if (error || !data) {
    return <span className="text-xs text-muted-foreground">Unavailable</span>
  }
  return <span>{formatSats(data.balanceSats)}</span>
}

function formatSats(sats: number): string {
  return `${sats.toLocaleString()} sats`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
