'use client'

import Link from 'next/link'
import { User, LogOut, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/client/hooks/use-api'
import { useNwcBalance } from '@/lib/client/use-nwc-balance'
import { useAuth } from '@/components/admin/auth-context'
import { BalanceHeader } from '@/components/wallet/shared/balance-header'
import {
  PrimaryActionButton,
  ArrowUpRight,
  ArrowDownLeft,
} from '@/components/wallet/shared/primary-action-button'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'

interface UserMeResponse {
  userId: string
  lightningAddress: string | null
  nwcString: string
  effectiveNwcString: string | null
  primaryAddressMode: string | null
  primaryUsername: string | null
}

export function HomeScreen() {
  const { logout, pubkey } = useAuth()
  const { data: me, loading: meLoading } = useApi<UserMeResponse>('/api/users/me')
  const effectiveNwc = me?.effectiveNwcString ?? null
  const { sats, status, error, loading, refetch } = useNwcBalance(effectiveNwc)

  const hasAddress = Boolean(me?.lightningAddress)

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-4 pt-6">
        <div className="flex items-center gap-2">
          <div
            className="flex size-9 items-center justify-center rounded-full bg-card text-xs font-medium text-muted-foreground"
            aria-hidden
          >
            <User className="size-4" />
          </div>
          <span className="text-xs text-muted-foreground truncate max-w-[140px]">
            {pubkey ? `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}` : '…'}
          </span>
        </div>
        <button
          type="button"
          onClick={logout}
          aria-label="Log out"
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </header>

      <BalanceHeader
        sats={sats}
        status={status}
        error={error}
        loading={loading || meLoading}
        onRefresh={refetch}
        lightningAddress={me?.lightningAddress ?? null}
      />

      {!hasAddress && !meLoading && (
        <Link
          href="/wallet/claim-username"
          className="mx-4 mb-4 flex items-center gap-3 rounded-xl border border-dashed border-nwc-purple/40 bg-nwc-purple/5 px-4 py-3 text-sm text-foreground transition-colors hover:bg-nwc-purple/10"
        >
          <Sparkles className="size-4 text-nwc-purple" />
          <span className="flex-1">Claim your free Lightning address</span>
          <span className="text-xs text-muted-foreground">→</span>
        </Link>
      )}

      <div className="flex gap-3 px-4">
        <PrimaryActionButton
          href="/wallet/send"
          label="Send"
          icon={ArrowUpRight}
          disabled={!effectiveNwc}
        />
        <PrimaryActionButton
          href="/wallet/receive"
          label="Receive"
          icon={ArrowDownLeft}
          disabled={!hasAddress && !effectiveNwc}
        />
      </div>

      {!effectiveNwc && !meLoading && (
        <div className="mx-4 mt-6 rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No wallet connected</p>
          <p className="mt-1 text-xs">
            Connect a Nostr Wallet Connect URI from the admin settings page to
            start sending and receiving.
          </p>
          <Button asChild variant="secondary" size="sm" className="mt-3">
            <Link href="/admin">Open admin</Link>
          </Button>
        </div>
      )}

      <div className="flex-1" />
      <NavTabbar />
    </div>
  )
}
