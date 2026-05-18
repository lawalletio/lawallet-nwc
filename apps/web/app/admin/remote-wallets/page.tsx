'use client'

import React from 'react'
import { Wallet } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TableSkeleton } from '@/components/admin/skeletons/table-skeleton'
import { CreateRemoteWalletDialog } from '@/components/admin/create-remote-wallet-dialog'
import {
  useRemoteWallets,
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
          <TableSkeleton rows={3} columns={5} />
        ) : !wallets || wallets.length === 0 ? (
          <EmptyState />
        ) : (
          <WalletsTable wallets={wallets} />
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

function WalletsTable({ wallets }: { wallets: RemoteWalletData[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Default</TableHead>
            <TableHead className="text-right">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {wallets.map(w => (
            <TableRow key={w.id}>
              <TableCell className="font-medium">{w.name}</TableCell>
              <TableCell>
                <Badge variant="outline">{w.type}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[w.status]}>{w.status}</Badge>
              </TableCell>
              <TableCell>
                {w.isDefault ? (
                  <Badge>Default</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatDate(w.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
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
