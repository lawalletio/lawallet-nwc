'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  AtSign,
  Link2Off,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Zap
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { BrandLogotype } from '@/components/ui/brand-logotype'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { createNsecSigner } from '@/lib/client/nostr-signer'
import {
  previewMagicLink,
  verifyEmailLink,
  verifyMagicLink
} from '@/lib/client/email-login-api'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { npubInitials, truncateNpub } from '@/lib/client/format'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import { useApi } from '@/lib/client/hooks/use-api'
import { postAuthPath } from '@/lib/client/pending-activation'
import { useT } from '@/lib/client/i18n'
import { cn } from '@/lib/utils'
import type { EmailLoginPreviewResponse } from '@/lib/validation/schemas'

type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'preview'; token: string; preview: EmailLoginPreviewResponse }
  | { kind: 'signing'; token: string; preview: EmailLoginPreviewResponse }
  | { kind: 'success'; preview: EmailLoginPreviewResponse; dest: string }
  // "Link this email to my account" links (`ctx=link`)
  | { kind: 'link'; token: string; linking: boolean }
  | { kind: 'linked'; merge: boolean; dest: string }

const REDIRECT_MS = 1600
/** The three dots of the LaWallet mark (same as the emails' footer). */
const BRAND_DOTS = ['#55b68c', '#fdc800', '#e95052']

/** Staggered entrance: `fade-in` delayed, held at frame 0 until it starts. */
function stagger(seconds: number): CSSProperties {
  return { animationDelay: `${seconds}s`, animationFillMode: 'both' }
}

/**
 * Magic-link landing. Reads the token from the URL fragment, previews WHO is
 * signing in (avatar + name) without consuming the token, and signs in only
 * on an explicit tap — so mail scanners that open links can't burn it.
 * Styled after lawallet.io and the magic-link email: dark canvas, accent glow,
 * mono eyebrow pill, heavy two-line headline with the accent on line two.
 */
export function EmailLanding() {
  const t = useT().auth.emailLanding
  const router = useRouter()
  const { login } = useAuth()
  const { data: settings } = useSettings()
  const community = settings?.community_name?.trim() || 'LaWallet'
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [error, setError] = useState<string | null>(null)

  // Read once and keep in a ref: the effect re-runs (StrictMode) after the
  // hash has already been scrubbed below.
  const tokenRef = useRef<string | null | undefined>(undefined)
  // Where sign-in started: `/wallet/auth/email` continues in the wallet,
  // `/admin/auth/email` on the dashboard.
  const contextRef = useRef<'admin' | 'wallet' | 'link'>('admin')
  // Username picked on the landing claim dialog (`claim` in the link).
  const claimRef = useRef<string | null>(null)

  useEffect(() => {
    if (tokenRef.current === undefined) {
      const params = new URLSearchParams(window.location.hash.slice(1))
      tokenRef.current = params.get('token')
      // The link's path is where sign-in started; `ctx=link` marks an
      // email-confirmation link. (`ctx=wallet` is from older links.)
      const ctx = params.get('ctx')
      if (ctx === 'link') contextRef.current = 'link'
      else if (
        ctx === 'wallet' ||
        (!ctx && window.location.pathname.startsWith('/wallet/'))
      )
        contextRef.current = 'wallet'
      const claim = params.get('claim')
      if (claim && /^[a-z0-9]{1,16}$/.test(claim)) claimRef.current = claim
      // Drop the token from the address bar / history right away.
      window.history.replaceState(null, '', window.location.pathname)
    }
    const token = tokenRef.current
    if (!token) {
      setPhase({ kind: 'invalid' })
      return
    }
    // A link token isn't previewable (no account to show yet) — confirm on tap.
    if (contextRef.current === 'link') {
      setPhase({ kind: 'link', token, linking: false })
      return
    }
    let cancelled = false
    previewMagicLink(token)
      .then(preview => {
        if (!cancelled) setPhase({ kind: 'preview', token, preview })
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: 'invalid' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The token is single-use: once verify succeeds, keep its result so a
  // failed session exchange can be retried without burning a new link.
  const verifiedRef = useRef<{ secretHex: string; isNew: boolean } | null>(null)

  async function handleContinue() {
    if (phase.kind !== 'preview') return
    const { token, preview } = phase
    setError(null)
    setPhase({ kind: 'signing', token, preview })
    try {
      verifiedRef.current ??= await verifyMagicLink(token)
      const { secretHex, isNew } = verifiedRef.current
      await login(createNsecSigner(secretHex), 'email', { secret: secretHex })
      // Only a brand-new signup is offered profile setup; signing in never
      // detours through it, even for a nameless account.
      const dest = claimRef.current
        ? `/admin/addresses/register?username=${claimRef.current}`
        : contextRef.current !== 'wallet'
          ? '/admin'
          : isNew
            ? '/wallet/settings/profile'
            : '/wallet'
      setPhase({ kind: 'success', preview, dest })
      window.setTimeout(() => router.replace(postAuthPath(dest)), REDIRECT_MS)
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 401) {
        setPhase({ kind: 'invalid' })
        return
      }
      setError(err instanceof Error ? err.message : String(err))
      setPhase({ kind: 'preview', token, preview })
    }
  }

  async function handleLinkEmail() {
    if (phase.kind !== 'link') return
    const { token } = phase
    setError(null)
    setPhase({ kind: 'link', token, linking: true })
    try {
      const res = await verifyEmailLink(token)
      // A merge ticket only works for the requesting account's session, so
      // both outcomes head back to that account's settings.
      const dest = res.mergeTicket
        ? `/admin/account?tab=login#merge=${encodeURIComponent(res.mergeTicket)}`
        : '/admin/account?tab=login'
      setPhase({ kind: 'linked', merge: !res.linked, dest })
      window.setTimeout(() => router.replace(dest), REDIRECT_MS)
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        setPhase({ kind: 'invalid' })
        return
      }
      setError(err instanceof Error ? err.message : String(err))
      setPhase({ kind: 'link', token, linking: false })
    }
  }

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background">
      <Backdrop />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pb-6 pt-8">
        <header className="animate-fade-in-down flex justify-center">
          <BrandLogotype width={112} height={26} className="h-6 w-auto" />
        </header>

        {phase.kind === 'loading' && <LoadingState label={t.checking} />}
        {phase.kind === 'invalid' && <InvalidState />}
        {(phase.kind === 'preview' || phase.kind === 'signing') && (
          <PreviewState
            preview={phase.preview}
            community={community}
            signing={phase.kind === 'signing'}
            error={error}
            onContinue={handleContinue}
          />
        )}
        {phase.kind === 'success' && (
          <SuccessState
            title={t.success}
            highlight={phase.preview.displayName}
            subtitle={
              phase.dest.startsWith('/admin')
                ? t.redirectingDashboard
                : phase.dest === '/wallet'
                  ? t.redirecting
                  : t.redirectingProfile
            }
          />
        )}
        {phase.kind === 'link' && (
          <LinkConfirmState
            community={community}
            linking={phase.linking}
            error={error}
            onConfirm={handleLinkEmail}
          />
        )}
        {phase.kind === 'linked' && (
          <SuccessState
            title={phase.merge ? t.linkMergeTitle : t.linkedTitle}
            subtitle={phase.merge ? t.redirectingMerge : t.redirectingAccount}
          />
        )}

        <footer className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="flex gap-1" aria-hidden>
            {BRAND_DOTS.map(c => (
              <span
                key={c}
                className="size-1.5 rounded-full"
                style={{ background: c }}
              />
            ))}
          </span>
          {t.poweredBy}
          <a
            href="https://lawallet.io"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-foreground/80 hover:text-foreground"
          >
            LaWallet
          </a>
        </footer>
      </div>
    </div>
  )
}

/** Static accent glow + the faint "@" of lawallet.io's hero. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute inset-x-0 top-0 h-[70vh] bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,hsl(var(--primary)/0.22),transparent_70%)]" />
      <span className="absolute left-1/2 top-[8%] -translate-x-1/2 select-none text-[26rem] font-black leading-none text-foreground/[0.025]">
        @
      </span>
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-background to-transparent" />
    </div>
  )
}

function Eyebrow({
  children,
  tone = 'accent'
}: {
  children: React.ReactNode
  tone?: 'accent' | 'muted'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em]',
        tone === 'accent'
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-muted/40 text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

function Headline({ line1, line2 }: { line1: string; line2?: string | null }) {
  return (
    <h1 className="text-[2.5rem] font-extrabold leading-[1.05] tracking-tight text-foreground">
      <span className="animate-fade-in block" style={stagger(0.1)}>
        {line1}
      </span>
      {line2 && (
        <span
          className="animate-fade-in block break-words text-primary"
          style={stagger(0.2)}
        >
          {line2}
        </span>
      )}
    </h1>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <main
      className="flex flex-1 flex-col items-center justify-center gap-4"
      aria-busy
    >
      <div
        role="progressbar"
        aria-label={label}
        className="h-1 w-48 overflow-hidden rounded-full bg-card"
      >
        <div className="h-full w-1/3 rounded-full bg-(--theme-300) animate-progress-indeterminate" />
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </main>
  )
}

function ProfileAvatar({ preview }: { preview: EmailLoginPreviewResponse }) {
  return (
    <div className="animate-scale-in relative size-24">
      <span className="animate-ring-expand absolute inset-0 rounded-full border border-primary/60" />
      {/* Slow-turning theme ring around the avatar. */}
      <span className="absolute -inset-1 rounded-full bg-[conic-gradient(from_0deg,var(--theme-200),hsl(var(--primary)),var(--theme-400),var(--theme-200))] motion-safe:animate-[spin_6s_linear_infinite]" />
      <span className="absolute inset-0 rounded-full bg-background" />
      {preview.isNew ? (
        <span className="absolute inset-1 grid place-items-center rounded-full bg-linear-to-b from-(--theme-200) to-(--theme-400) text-foreground">
          <Sparkles className="size-9" />
        </span>
      ) : (
        <Avatar className="absolute inset-1 size-auto">
          {preview.picture && <AvatarImage src={preview.picture} alt="" />}
          <AvatarFallback className="text-xl font-semibold">
            {preview.pubkey
              ? npubInitials(preview.pubkey)
              : preview.email.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  )
}

function PreviewState({
  preview,
  community,
  signing,
  error,
  onContinue
}: {
  preview: EmailLoginPreviewResponse
  community: string
  signing: boolean
  error: string | null
  onContinue: () => void
}) {
  const t = useT().auth.emailLanding
  const name = preview.displayName
  const [line1, line2] = preview.isNew
    ? [t.welcomeTo, community]
    : name
      ? [t.welcomeBack, name]
      : [t.signInTo, community]
  const cta = preview.isNew
    ? t.createAccount
    : name
      ? t.continueAs(name)
      : t.continue
  const perks = [
    { icon: Zap, label: t.perks.address },
    { icon: AtSign, label: t.perks.nostr },
    { icon: ShieldCheck, label: t.perks.custody }
  ]

  return (
    <>
      <main className="flex flex-1 flex-col justify-center gap-6 py-8">
        <div className="animate-fade-in" style={stagger(0)}>
          <Eyebrow>
            <Zap className="size-3" />
            {t.eyebrow}
          </Eyebrow>
        </div>

        {/* A returning user without a picture gets no initials placeholder;
            new users keep the welcome badge. */}
        {(preview.isNew || preview.picture) && (
          <ProfileAvatar preview={preview} />
        )}

        <div className="space-y-3">
          <Headline line1={line1} line2={line2} />
          <p
            className="animate-fade-in text-base text-muted-foreground"
            style={stagger(0.3)}
          >
            {preview.isNew ? t.newBody : t.returningBody}
          </p>
        </div>

        <div className="animate-fade-in" style={stagger(0.38)}>
          <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 font-mono text-xs text-foreground/90 backdrop-blur">
            <Mail className="size-3.5 shrink-0 text-primary" />
            <span className="truncate">{preview.email}</span>
          </span>
        </div>

        {preview.isNew && (
          <ul
            className="animate-fade-in divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur"
            style={stagger(0.46)}
          >
            {perks.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="text-sm text-foreground">{label}</span>
              </li>
            ))}
          </ul>
        )}
      </main>

      <div className="animate-fade-in space-y-3" style={stagger(0.55)}>
        <Button
          variant="theme"
          className="group h-12 w-full text-base"
          disabled={signing}
          onClick={onContinue}
        >
          {signing ? (
            <>
              <Spinner size={16} />
              {t.signingIn}
            </>
          ) : (
            <>
              <span className="truncate">{cta}</span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </Button>
        {error ? (
          <p role="alert" className="text-center text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="size-3 shrink-0" />
            {t.oneTime}
          </p>
        )}
      </div>
    </>
  )
}

function SuccessState({
  title,
  highlight,
  subtitle
}: {
  title: string
  highlight?: string | null
  subtitle: string
}) {
  return (
    <main
      className="flex flex-1 flex-col items-center justify-center gap-8 text-center"
      role="status"
    >
      <div className="animate-success-pop relative grid size-28 place-items-center">
        <span className="animate-ring-expand absolute inset-0 rounded-full border-2 border-primary" />
        <span
          className="animate-ring-expand absolute inset-0 rounded-full border-2 border-primary"
          style={{ animationDelay: '0.6s' }}
        />
        <span
          className="grid size-24 place-items-center rounded-full border border-(--theme-300) bg-linear-to-b from-(--theme-200) to-(--theme-400) text-foreground"
          style={{ boxShadow: '0 0 40px hsl(var(--primary) / 0.55)' }}
        >
          <svg viewBox="0 0 52 52" className="size-12" fill="none" aria-hidden>
            <path
              d="M14 27 L23 36 L39 18"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: 48,
                strokeDashoffset: 48,
                animation: 'draw-check 0.5s ease-out 0.35s forwards'
              }}
            />
          </svg>
        </span>
      </div>

      <div className="space-y-3">
        <Headline line1={title} line2={highlight} />
        <p
          className="animate-fade-in text-sm text-muted-foreground"
          style={stagger(0.3)}
        >
          {subtitle}
        </p>
      </div>

      <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full origin-left rounded-full bg-primary"
          style={{ animation: `grow-x ${REDIRECT_MS}ms linear both` }}
        />
      </div>
    </main>
  )
}

function LinkConfirmState({
  community,
  linking,
  error,
  onConfirm
}: {
  community: string
  linking: boolean
  error: string | null
  onConfirm: () => void
}) {
  const t = useT().auth.emailLanding
  const { status, pubkey } = useAuth()
  const signedIn = status === 'authenticated' && !!pubkey
  return (
    <>
      <main className="flex flex-1 flex-col justify-center gap-6 py-8">
        <div className="animate-fade-in">
          <Eyebrow>
            <Mail className="size-3" />
            {t.linkEyebrow}
          </Eyebrow>
        </div>
        <div className="space-y-3">
          <Headline
            line1={t.linkTitle}
            line2={signedIn ? t.linkYourAccount : community}
          />
          <p
            className="animate-fade-in text-base text-muted-foreground"
            style={stagger(0.3)}
          >
            {t.linkBody}
          </p>
        </div>
        {signedIn ? (
          <LinkAccountCard pubkey={pubkey} />
        ) : (
          <span className="animate-scale-in grid size-20 place-items-center rounded-full border border-(--theme-300) bg-linear-to-b from-(--theme-200) to-(--theme-400) text-foreground shadow-[0_0_40px_hsl(var(--primary)/0.45)]">
            <Mail className="size-8" />
          </span>
        )}
      </main>
      <div className="animate-fade-in space-y-3" style={stagger(0.4)}>
        <Button
          variant="theme"
          className="group h-12 w-full text-base"
          disabled={linking}
          onClick={onConfirm}
        >
          {linking ? (
            <>
              <Spinner size={16} />
              {t.linking}
            </>
          ) : (
            <>
              {t.linkCta}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </Button>
        {error ? (
          <p role="alert" className="text-center text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="size-3 shrink-0" />
            {t.oneTime}
          </p>
        )}
      </div>
    </>
  )
}

/**
 * The signed-in account the email is about to join: its Nostr cover, avatar,
 * name and primary lightning address, so it's clear where the email lands.
 */
function LinkAccountCard({ pubkey }: { pubkey: string }) {
  const t = useT().auth.emailLanding
  const { profile, loading } = useNostrProfile(pubkey)
  const { data: me } = useApi<{ lightningAddress: string | null }>(
    '/api/users/me'
  )
  const name = profile?.displayName || profile?.name
  const subtitle =
    me?.lightningAddress || profile?.nip05 || truncateNpub(pubkey)

  return (
    <div
      className="animate-fade-in overflow-hidden rounded-3xl border bg-card shadow-[0_24px_60px_-28px_hsl(var(--primary)/0.55)]"
      style={stagger(0.35)}
    >
      {/* Cover: the profile banner, or a theme glow + grid when there is none. */}
      <div className="relative h-28 overflow-hidden bg-linear-to-br from-(--theme-200) via-(--theme-400) to-background">
        {profile?.banner ? (
          <img src={profile.banner} alt="" className="size-full object-cover" />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 opacity-25 [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_80%)]"
          />
        )}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-card to-transparent"
        />
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-background/70 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur">
          <ShieldCheck className="size-3 text-primary" />
          {t.linkSignedIn}
        </span>
      </div>

      <div className="relative px-5 pb-5">
        <Avatar className="-mt-10 size-20 border-4 border-card shadow-lg">
          {profile?.picture && <AvatarImage src={profile.picture} alt="" />}
          <AvatarFallback />
        </Avatar>
        <div className="mt-3 min-w-0">
          {name ? (
            <p className="truncate text-xl font-bold tracking-tight">{name}</p>
          ) : loading ? (
            <span className="block h-6 w-36 animate-pulse rounded-md bg-muted" />
          ) : (
            <p className="truncate text-xl font-bold tracking-tight">
              {truncateNpub(pubkey)}
            </p>
          )}
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {me?.lightningAddress ? (
              <Zap className="size-3.5 shrink-0 text-primary" />
            ) : (
              <AtSign className="size-3.5 shrink-0" />
            )}
            <span className="truncate font-mono text-xs">{subtitle}</span>
          </p>
        </div>
      </div>
    </div>
  )
}

function InvalidState() {
  const t = useT().auth.emailLanding
  return (
    <>
      <main className="flex flex-1 flex-col justify-center gap-6 py-8">
        <div className="animate-fade-in">
          <Eyebrow tone="muted">{t.invalidEyebrow}</Eyebrow>
        </div>
        <span className="animate-scale-in grid size-20 place-items-center rounded-full border border-border bg-card text-muted-foreground">
          <Link2Off className="size-8" />
        </span>
        <div className="space-y-3">
          <Headline line1={t.invalidTitle} />
          <p
            className="animate-fade-in text-base text-muted-foreground"
            style={stagger(0.2)}
          >
            {t.invalidBody}
          </p>
        </div>
      </main>
      <div className="animate-fade-in" style={stagger(0.3)}>
        <Button asChild variant="theme" className="h-12 w-full text-base">
          <Link href="/wallet/login">
            {t.requestNew}
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </>
  )
}
