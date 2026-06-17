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
  if (!username) return `/admin/addresses?configure=${mode}`
  return `/admin/addresses/${encodeURIComponent(username)}?configure=${mode}`
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
