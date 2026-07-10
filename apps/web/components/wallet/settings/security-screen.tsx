'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft,
  KeyRound,
  LogOut,
  ShieldCheck,
  UserRound
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import { useAuth, type LoginMethod } from '@/components/admin/auth-context'
import { toNpub, truncateNpub } from '@/lib/client/format'
import { cn } from '@/lib/utils'

export function SecurityScreen() {
  const router = useRouter()
  const {
    jwt,
    loginMethod,
    logout,
    pubkey,
    requestSigner,
    role,
    signer,
    status
  } = useAuth()

  async function handleCopyPubkey() {
    if (!pubkey) return
    const npub = toNpub(pubkey)
    try {
      await copyText(npub)
      toast.success('npub copied')
    } catch {
      toast.error('Could not copy npub')
    }
  }

  async function handleVerifySigner() {
    try {
      await requestSigner()
      toast.success('Signer ready')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signer unavailable')
    }
  }

  function handleRemoveDevice() {
    const confirmed = window.confirm('Remove this wallet from this device?')
    if (!confirmed) return
    logout()
    router.replace('/wallet/landing')
  }

  return (
    <div className="flex flex-1 flex-col pb-32">
      <header className="sticky top-0 z-20 grid h-14 grid-cols-3 items-center bg-background/80 px-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-fit items-center gap-1.5 rounded-full bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ChevronLeft className="size-4" />
          Back
        </button>
        <h1 className="text-center text-base font-semibold text-foreground">
          Security
        </h1>
        <span aria-hidden />
      </header>

      <main className="flex flex-1 flex-col gap-6 px-4 pt-4">
        <Section title="Account">
          <RowGroup>
            <InfoRow
              icon={<UserRound className="size-5" />}
              label="Public key"
              value={pubkey ? truncateNpub(pubkey) : 'Not signed in'}
              onClick={pubkey ? () => void handleCopyPubkey() : undefined}
            />
            <InfoRow
              label="Role"
              value={role ? role.toLowerCase() : 'Unknown'}
              valueClassName="capitalize"
            />
            <InfoRow label="Login method" value={loginMethodLabel(loginMethod)} />
          </RowGroup>
        </Section>

        <Section title="Session">
          <RowGroup>
            <StatusRow
              icon={<ShieldCheck className="size-5" />}
              label="Session"
              active={status === 'authenticated' && Boolean(jwt)}
              activeLabel="Active"
              inactiveLabel="Locked"
            />
            <StatusRow
              icon={<KeyRound className="size-5" />}
              label="Signer"
              active={Boolean(signer)}
              activeLabel="Unlocked"
              inactiveLabel="Locked"
            />
          </RowGroup>
          <Button
            type="button"
            variant="secondary"
            className="h-12 w-full"
            onClick={() => void handleVerifySigner()}
          >
            <ShieldCheck data-icon="inline-start" />
            Verify signer
          </Button>
        </Section>

        <Section title="Device" className="mt-auto">
          <Button
            type="button"
            variant="destructive"
            className="h-12 w-full"
            onClick={handleRemoveDevice}
          >
            <LogOut data-icon="inline-start" />
            Remove wallet from device
          </Button>
        </Section>
      </main>

      <NavTabbar />
    </div>
  )
}

function Section({
  title,
  children,
  className
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col rounded-2xl bg-card">{children}</div>
}

function InfoRow({
  icon,
  label,
  onClick,
  value,
  valueClassName
}: {
  icon?: React.ReactNode
  label: string
  onClick?: () => void
  value: string
  valueClassName?: string
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
            {icon}
          </span>
        )}
        <span className="text-base font-medium text-foreground">{label}</span>
      </div>
      <span
        className={cn(
          'max-w-[48%] truncate text-right text-sm text-muted-foreground',
          valueClassName
        )}
      >
        {value}
      </span>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Copy ${label}`}
        className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-border/40 px-4 text-left transition-colors hover:bg-accent/40 active:bg-accent/60 last:border-b-0"
      >
        {content}
      </button>
    )
  }

  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border/40 px-4 last:border-b-0">
      {content}
    </div>
  )
}

function StatusRow({
  active,
  activeLabel,
  icon,
  inactiveLabel,
  label
}: {
  active: boolean
  activeLabel: string
  icon?: React.ReactNode
  inactiveLabel: string
  label: string
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border/40 px-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
            {icon}
          </span>
        )}
        <span className="text-base font-medium text-foreground">{label}</span>
      </div>
      <Badge variant={active ? 'default' : 'secondary'}>
        {active ? activeLabel : inactiveLabel}
      </Badge>
    </div>
  )
}

function loginMethodLabel(method: LoginMethod | null) {
  switch (method) {
    case 'bunker':
      return 'Bunker'
    case 'extension':
      return 'Extension'
    case 'nsec':
      return 'Private key'
    default:
      return 'Unknown'
  }
}

async function copyText(value: string) {
  if (copyWithSelection(value)) return

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  throw new Error('Clipboard unavailable')
}

function copyWithSelection(value: string) {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}
