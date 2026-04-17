'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { useSettings } from '@/lib/client/hooks/use-settings'
import {
  useMyAddresses,
  useAddressMutations,
  type WalletAddress,
} from '@/lib/client/hooks/use-wallet-addresses'
import { NewAddressDialog } from '@/components/wallet/new-address-dialog'
import { cn } from '@/lib/utils'

const NWC_LABEL: Record<WalletAddress['nwcMode'], string> = {
  NONE: 'None',
  RECEIVE: 'Receive',
  SEND_RECEIVE: 'Send and Receive',
}

/**
 * Human label for the configured `LightningAddress.mode` — what the user
 * actually picked on the edit page. Distinct from NWC_LABEL above, which
 * describes the *derived* effective capability.
 */
const MODE_LABEL: Record<WalletAddress['mode'], string> = {
  IDLE: 'Idle',
  ALIAS: 'Alias',
  CUSTOM_NWC: 'Custom NWC',
  DEFAULT_NWC: 'Default NWC',
}

/**
 * /admin/addresses — the signed-in user's own lightning addresses.
 *
 * Even though this route lives under /admin, the data is per-user (driven by
 * the authenticated pubkey via /api/wallet/addresses). Plain USERs without
 * the ADDRESSES_READ permission still see this page; the admin sidebar
 * routes everyone here. This used to live at /wallet/addresses — moved on
 * 2026-04-16 so address management is a single page regardless of role.
 */
export default function AdminAddressesPage() {
  const router = useRouter()
  const { data: settings } = useSettings()
  const { data: addresses, loading, refetch } = useMyAddresses()
  const { setAsPrimary, settingPrimary } = useAddressMutations()
  const [createOpen, setCreateOpen] = useState(false)

  const domain = settings?.domain || 'your-domain'

  async function handleSetPrimary(username: string) {
    try {
      await setAsPrimary(username)
      toast.success(`${username}@${domain} is now primary`)
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set primary')
    }
  }

  /**
   * Copy the full lightning address (username@domain) to the clipboard.
   * Falls back to a textarea + execCommand in insecure contexts (http:// in
   * local dev). Toast confirms success either way.
   */
  async function handleCopyAddress(username: string) {
    const full = `${username}@${domain}`
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(full)
      } else {
        const ta = document.createElement('textarea')
        ta.value = full
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      toast.success(`Copied ${full}`)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Addresses"
        subtitle="Lightning addresses connected to your wallet. Choose which one is primary, route them through NWC, or alias them to another address."
        actions={
          <Button variant="theme" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New address
          </Button>
        }
      />

      <div className="space-y-4 px-4 py-6 sm:px-6">
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Redirect</TableHead>
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-12 text-center">
                    <Spinner size={24} />
                  </TableCell>
                </TableRow>
              ) : !addresses || addresses.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    You don&rsquo;t have any addresses yet.{' '}
                    <button
                      type="button"
                      onClick={() => setCreateOpen(true)}
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      Create your first one
                    </button>
                    .
                  </TableCell>
                </TableRow>
              ) : (
                addresses.map(addr => (
                  <TableRow key={addr.username}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {/* Mobile: username only — @domain takes too much
                            horizontal room next to the Primary badge. From
                            sm: up we show the full address. */}
                        <span className="font-medium">
                          {addr.username}
                          <span className="hidden sm:inline">@{domain}</span>
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopyAddress(addr.username)}
                          aria-label={`Copy ${addr.username}@${domain}`}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                        {addr.isPrimary && (
                          <Badge variant="secondary" className="text-xs">
                            Primary
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {/* Column shows the *configured* LightningAddress
                            mode (what the user picked on the edit page).
                            For NWC modes the sub-line discloses the
                            *derived* capability (Receive / Send & Receive /
                            None) so the row tells you both intent and
                            effective state without the columns drifting. */}
                        <Badge
                          variant={
                            addr.mode === 'IDLE' ||
                            ((addr.mode === 'CUSTOM_NWC' || addr.mode === 'DEFAULT_NWC') &&
                              addr.nwcMode === 'NONE')
                              ? 'outline'
                              : 'default'
                          }
                          className={cn(
                            'w-fit text-xs',
                            addr.mode === 'IDLE' && 'italic text-muted-foreground',
                          )}
                        >
                          {MODE_LABEL[addr.mode]}
                        </Badge>

                        {(addr.mode === 'CUSTOM_NWC' || addr.mode === 'DEFAULT_NWC') && (
                          addr.nwcMode === 'NONE' ? (
                            <span className="text-xs italic text-muted-foreground">
                              None
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {NWC_LABEL[addr.nwcMode]}
                            </span>
                          )
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {addr.mode === 'ALIAS' && addr.redirect ? addr.redirect : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              router.push(
                                `/admin/addresses/${encodeURIComponent(addr.username)}`,
                              )
                            }
                          >
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={addr.isPrimary || settingPrimary}
                            onClick={() => handleSetPrimary(addr.username)}
                          >
                            Set as primary
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <NewAddressDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refetch}
      />
    </div>
  )
}
