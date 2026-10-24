'use client'

import React, { useState } from 'react'
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
import { SecretKeyReveal } from '@/components/shared/secret-key-reveal'
import { useAuth } from '@/components/admin/auth-context'
import { PasskeysSection } from '@/components/wallet/settings/passkeys-section'
import { CardRecoverySection } from '@/components/wallet/settings/card-recovery-section'
import { ConnectedApps } from '@/components/oauth/connected-apps'
import { hexToNsec } from '@/lib/nostr'
import { toNpub, truncateNpub } from '@/lib/client/format'
import { useT } from '@/lib/client/i18n'
import type { PasskeyImportSource } from '@/lib/passkey-import-sources'
import { cn } from '@/lib/utils'

const SIGNER_SECRET_KEY = 'lawallet-signer-secret'

export function SecurityScreen({
  passkeyImportSources = []
}: {
  passkeyImportSources?: PasskeyImportSource[]
} = {}) {
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
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const t = useT()
  const s = t.settings.securityScreen

  async function handleCopyPubkey() {
    if (!pubkey) return
    const npub = toNpub(pubkey)
    try {
      await copyText(npub)
      toast.success(s.npubCopied)
    } catch {
      toast.error(s.copyFailed)
    }
  }

  async function handleVerifySigner() {
    try {
      await requestSigner()
      toast.success(s.signerReady)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : s.signerUnavailable)
    }
  }

  function handleRemoveDevice() {
    const confirmed = window.confirm(s.removeConfirm)
    if (!confirmed) return
    logout()
    router.replace('/wallet/landing')
  }

  // nsec and passkey sessions keep the (PRF-derived) secret in localStorage;
  // read it at click time so we never hold it in state before the user asks.
  function handleRevealSecret() {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(SIGNER_SECRET_KEY)
    } catch {
      // Storage blocked — same as nothing stored.
    }
    if (!stored) {
      toast.error(s.noSecret)
      return
    }
    setRevealedSecret(
      /^[0-9a-f]{64}$/i.test(stored) ? hexToNsec(stored) : stored
    )
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
          {t.common.back}
        </button>
        <h1 className="text-center text-base font-semibold text-foreground">
          {t.settings.security}
        </h1>
        <span aria-hidden />
      </header>

      <main className="flex flex-1 flex-col gap-6 px-4 pt-4">
        <Section title={t.settings.account}>
          <RowGroup>
            <InfoRow
              icon={<UserRound className="size-5" />}
              label={s.publicKey}
              value={pubkey ? truncateNpub(pubkey) : s.notSignedIn}
              onClick={pubkey ? () => void handleCopyPubkey() : undefined}
            />
            <InfoRow
              label={s.role}
              value={role ? (s.roles[role] ?? role.toLowerCase()) : s.unknown}
              valueClassName="capitalize"
            />
            <InfoRow
              label={s.loginMethod}
              value={
                loginMethod && loginMethod in s.methods
                  ? s.methods[loginMethod as keyof typeof s.methods]
                  : s.unknown
              }
            />
          </RowGroup>
        </Section>

        <Section title={s.session}>
          <RowGroup>
            <StatusRow
              icon={<ShieldCheck className="size-5" />}
              label={s.session}
              active={status === 'authenticated' && Boolean(jwt)}
              activeLabel={s.active}
              inactiveLabel={s.sessionLocked}
            />
            <StatusRow
              icon={<KeyRound className="size-5" />}
              label={s.signer}
              active={Boolean(signer)}
              activeLabel={s.unlocked}
              inactiveLabel={s.signerLocked}
            />
          </RowGroup>
          <Button
            type="button"
            variant="secondary"
            className="h-12 w-full"
            onClick={() => void handleVerifySigner()}
          >
            <ShieldCheck data-icon="inline-start" />
            {s.verifySigner}
          </Button>
        </Section>

        <Section title={s.passkeys}>
          <PasskeysSection importSources={passkeyImportSources} />
        </Section>

        <Section title={s.connectedApps}>
          <ConnectedApps />
        </Section>

        <Section title={s.cardRecovery.title}>
          <CardRecoverySection />
        </Section>

        {(loginMethod === 'nsec' || loginMethod === 'passkey') && (
          <Section title={s.secretKey}>
            {revealedSecret ? (
              <SecretKeyReveal nsec={revealedSecret} />
            ) : (
              <Button
                type="button"
                variant="secondary"
                className="h-12 w-full"
                onClick={handleRevealSecret}
              >
                <KeyRound data-icon="inline-start" />
                {s.revealSecret}
              </Button>
            )}
            <p className="px-1 text-xs text-muted-foreground">
              {loginMethod === 'passkey' ? s.passkeyKeyHint : s.nsecKeyHint}
            </p>
          </Section>
        )}

        <Section title={s.device} className="mt-auto">
          <Button
            type="button"
            variant="destructive"
            className="h-12 w-full"
            onClick={handleRemoveDevice}
          >
            <LogOut data-icon="inline-start" />
            {s.removeDevice}
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
  const t = useT()
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
        aria-label={t.settings.securityScreen.copyLabel(label)}
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
