'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Copy, Forward, MoreHorizontal, Plus, Star } from 'lucide-react'
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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

  // Optimistic override for Set-as-primary. When the user clicks "Set as
  // primary" we flip the star visually before the POST returns — on success
  // the refetched data agrees and we drop the override; on failure we drop
  // it and the star snaps back to the server's reality (plus a toast).
  // Null when no optimistic flip is in flight.
  const [optimisticPrimary, setOptimisticPrimary] = useState<string | null>(null)

  async function handleSetPrimary(username: string) {
    setOptimisticPrimary(username)
    try {
      await setAsPrimary(username)
      // Await the refetch so the real data has landed *before* we clear the
      // override — otherwise there's a one-frame window where both the
      // override is gone and the fetched list still shows the old primary.
      await refetch()
      toast.success(`${username}@${domain} is now primary`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set primary')
    } finally {
      setOptimisticPrimary(null)
    }
  }

  // Apply the optimistic override on top of the server data. When active,
  // exactly one row is primary (the one the user just clicked) and every
  // other row is non-primary, even if the server hasn't confirmed yet.
  const displayedAddresses = addresses?.map(a =>
    optimisticPrimary !== null
      ? { ...a, isPrimary: a.username === optimisticPrimary }
      : a,
  )

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
        subtitle="Manage your lightning addresses."
        actions={
          <Button variant="theme" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New address
          </Button>
        }
      />

      {/* TooltipProvider scoped to the page body so any tooltip trigger
          inside the table (e.g. the Primary-address star) mounts without
          callers needing to remember the provider. `delayDuration={150}`
          feels responsive on hover while still avoiding accidental fires
          on quick mouse passes. */}
      <TooltipProvider delayDuration={150}>
      <div className="space-y-4 px-4 py-6 sm:px-6">
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-12 text-center">
                    <Spinner size={24} />
                  </TableCell>
                </TableRow>
              ) : !displayedAddresses || displayedAddresses.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
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
                displayedAddresses.map(addr => (
                  <TableRow key={addr.username}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {/* The address text itself is now the primary
                            affordance for navigating to the edit page;
                            Copy (button next to it) and Edit (dropdown)
                            are peers rather than the only ways in. Mobile
                            hides @domain since it consumes too much room
                            next to the star + actions. */}
                        <Link
                          href={`/admin/addresses/${encodeURIComponent(addr.username)}`}
                          className="font-medium hover:underline underline-offset-4"
                        >
                          {addr.username}
                          <span className="hidden sm:inline">@{domain}</span>
                        </Link>
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
                          <>
                            {/* Mobile: compact star with a hover/focus
                                tooltip — there's no room for a full
                                "Primary" pill next to the copy button
                                and the @domain-less address. */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className="inline-flex size-5 items-center justify-center text-yellow-500 sm:hidden"
                                  aria-label="Primary address"
                                >
                                  <Star
                                    className="size-4 fill-current"
                                    aria-hidden
                                  />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Primary</TooltipContent>
                            </Tooltip>
                            {/* Desktop: full Primary badge with a star
                                prefix. No tooltip needed here since the
                                label is already readable. */}
                            <Badge
                              variant="secondary"
                              className="hidden items-center gap-1 text-xs sm:inline-flex"
                            >
                              <Star
                                className="size-3 fill-yellow-500 text-yellow-500"
                                aria-hidden
                              />
                              Primary
                            </Badge>
                          </>
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
                        {/* ALIAS gets a single condensed badge
                            `[→ target]` instead of the generic "Alias"
                            label plus a separate redirect sub-line — the
                            target address *is* the mode in this case, so
                            surfacing it as the badge content keeps the
                            cell to one row and conveys both intent and
                            destination at once. */}
                        {addr.mode === 'ALIAS' ? (
                          addr.redirect && (
                            <Badge
                              variant="outline"
                              className="w-fit items-center gap-1 font-mono text-xs font-normal"
                            >
                              <Forward className="size-3 shrink-0" aria-hidden />
                              <span className="break-all">{addr.redirect}</span>
                            </Badge>
                          )
                        ) : (
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
                        )}

                        {/* Only surface the derived NWC capability when
                            we actually resolved one. A "None" sub-line
                            under the badge duplicated the outline badge's
                            own muted styling and wasted a row of height. */}
                        {(addr.mode === 'CUSTOM_NWC' || addr.mode === 'DEFAULT_NWC') &&
                          addr.nwcMode !== 'NONE' && (
                            <span className="text-xs text-muted-foreground">
                              {NWC_LABEL[addr.nwcMode]}
                            </span>
                          )}
                      </div>
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
      </TooltipProvider>

      <NewAddressDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refetch}
      />
    </div>
  )
}
