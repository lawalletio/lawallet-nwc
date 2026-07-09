'use client'

import Link from 'next/link'
import { Forward, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AddressRoutingShortcutsProps {
  username: string | null | undefined
  className?: string
}

function addressConfigureHref(
  username: string | null | undefined,
  mode: 'wallet' | 'redirect',
) {
  const query =
    mode === 'redirect'
      ? 'configure=redirect&mode=alias&focus=redirect'
      : 'configure=wallet&mode=custom_nwc&focus=wallet'
  if (!username) return `/admin/addresses?${query}`
  return `/admin/addresses/${encodeURIComponent(username)}?${query}`
}

export function AddressRoutingShortcuts({
  username,
  className,
}: AddressRoutingShortcutsProps) {
  const options = [
    {
      label: 'Connect wallet',
      icon: Wallet,
      href: addressConfigureHref(username, 'wallet'),
      tone: 'wallet',
    },
    {
      label: 'Redirect',
      icon: Forward,
      href: addressConfigureHref(username, 'redirect'),
      tone: 'redirect',
    },
  ] as const

  return (
    <div className={cn('grid w-full grid-cols-2 gap-4', className)}>
      {options.map(option => (
        <Link
          key={option.label}
          href={option.href}
          className={cn(
            'group relative isolate flex h-[clamp(220px,34vw,338px)] max-h-[338px] overflow-hidden rounded-xl border p-5 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_18px_44px_rgba(0,0,0,0.22)] active:translate-y-0',
            option.tone === 'wallet'
              ? 'border-[#897FFF]/30 bg-[radial-gradient(circle_at_22%_18%,rgba(137,127,255,0.22),transparent_34%),linear-gradient(135deg,rgba(137,127,255,0.14),rgba(137,127,255,0.035)_62%,rgba(255,255,255,0.035))] hover:border-[#897FFF]/70'
              : 'border-primary/30 bg-[radial-gradient(circle_at_22%_18%,hsl(var(--primary)/0.22),transparent_34%),linear-gradient(135deg,hsl(var(--primary)/0.14),hsl(var(--primary)/0.035)_62%,rgba(255,255,255,0.035))] hover:border-primary/70',
          )}
        >
          <option.icon
            className={cn(
              'absolute -bottom-[10%] -right-[7%] z-[-1] size-[88%] stroke-[1.05] opacity-55 transition-[opacity,transform] duration-300 ease-out group-hover:scale-110 group-hover:rotate-[-4deg] group-hover:opacity-75',
              option.tone === 'wallet' ? 'text-[#897FFF]' : 'text-primary',
            )}
            aria-hidden
          />
          <span
            className={cn(
              'absolute inset-3 z-[-2] rounded-lg opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-100',
              option.tone === 'wallet'
                ? 'bg-[#897FFF]/25'
                : 'bg-primary/25',
            )}
            aria-hidden
          />
          <span className="mt-auto inline-flex items-center rounded-full border border-white/10 bg-background/55 px-4 py-2 text-lg font-semibold leading-none text-foreground shadow-sm backdrop-blur transition-colors group-hover:bg-background/75 sm:text-xl">
            {option.label}
          </span>
        </Link>
      ))}
    </div>
  )
}

interface AddressRedirectCardProps {
  username: string | null | undefined
  redirect: string
  className?: string
}

/**
 * Status card shown on the admin home when the primary address is already set
 * to forward (mode ALIAS). Replaces the "Connect wallet / Redirect" choice
 * cards: the redirect target is configured, so we surface where it points and
 * link to the config to change or remove it.
 */
export function AddressRedirectCard({
  username,
  redirect,
  className,
}: AddressRedirectCardProps) {
  return (
    <Link
      href={addressConfigureHref(username, 'redirect')}
      className={cn(
        'group relative isolate flex w-full items-center gap-4 overflow-hidden rounded-xl border border-primary/30 bg-[radial-gradient(circle_at_22%_18%,hsl(var(--primary)/0.22),transparent_38%),linear-gradient(135deg,hsl(var(--primary)/0.14),hsl(var(--primary)/0.035)_62%,rgba(255,255,255,0.035))] p-5 text-left transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/70 hover:shadow-[0_18px_44px_rgba(0,0,0,0.22)]',
        className,
      )}
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Forward className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">Redirecting to</p>
        <p className="truncate text-base font-semibold text-foreground sm:text-lg">
          {redirect}
        </p>
      </div>
      <Forward
        className="pointer-events-none absolute -bottom-[22%] -right-[4%] z-[-1] size-[55%] stroke-[1.05] text-primary opacity-15 transition-opacity duration-300 group-hover:opacity-25"
        aria-hidden
      />
    </Link>
  )
}
