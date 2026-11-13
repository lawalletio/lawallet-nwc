'use client'

import { useEffect, useState } from 'react'
import { Mail, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { requestMagicLink } from '@/lib/client/email-login-api'
import { useLocale, useT } from '@/lib/client/i18n'
import { cn } from '@/lib/utils'
import type { EmailLoginContext } from '@/lib/validation/schemas'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESEND_COOLDOWN_S = 30

interface EmailLoginFormProps {
  className?: string
  /** Where the magic link should land after sign-in. */
  context?: EmailLoginContext
  /** Username to resume claiming once the magic link signs in. */
  claimUsername?: string
  /** Fires when the form switches to / from its "check your inbox" state. */
  onSentChange?: (sent: boolean) => void
}

/**
 * One form for everybody: type an email, get a magic link. The server signs
 * in a known address and signs up an unknown one when the link is opened.
 */
export function EmailLoginForm({
  className,
  context,
  claimUsername,
  onSentChange
}: EmailLoginFormProps) {
  // Outside the wallet's I18nProvider (admin modal) this is English.
  const copy = useT().auth.emailLogin
  const locale = useLocale()
  const [email, setEmail] = useState('')
  const [sentTo, setSentToState] = useState<string | null>(null)
  function setSentTo(value: string | null) {
    setSentToState(value)
    onSentChange?.(value !== null)
  }
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  async function send(target: string) {
    const normalized = target.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalized)) {
      setError(copy.invalid)
      return
    }
    setSending(true)
    setError(null)
    try {
      await requestMagicLink(normalized, locale, context, claimUsername)
      setSentTo(normalized)
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      // Never leave "check your inbox" up after a failed (re)send.
      setSentTo(null)
      setError(err instanceof Error && err.message ? err.message : copy.failed)
    } finally {
      setSending(false)
    }
  }

  if (sentTo) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-4 rounded-2xl border bg-card/50 p-6 text-center',
          className
        )}
        role="status"
      >
        <div className="animate-success-pop relative grid size-16 place-items-center">
          <span className="animate-ring-expand absolute inset-0 rounded-full border-2 border-primary" />
          <span className="grid size-14 place-items-center rounded-full bg-primary/15 text-primary">
            <MailCheck className="size-7" />
          </span>
        </div>
        <div className="animate-fade-in space-y-1">
          <p className="text-base font-semibold text-foreground">
            {copy.checkInbox}
          </p>
          <p className="text-sm text-muted-foreground">{copy.sentTo(sentTo)}</p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="animate-fade-in flex w-full flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            className="h-11 w-full"
            disabled={cooldown > 0 || sending}
            onClick={() => send(sentTo)}
          >
            {sending ? (
              <Spinner size={16} />
            ) : cooldown > 0 ? (
              copy.resendIn(cooldown)
            ) : (
              copy.resend
            )}
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setSentTo(null)
              setError(null)
            }}
          >
            {copy.useDifferent}
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      className={cn('flex flex-col gap-2', className)}
      onSubmit={e => {
        e.preventDefault()
        void send(email)
      }}
      noValidate
    >
      <label htmlFor="email-login" className="sr-only">
        {copy.label}
      </label>
      <div className="relative">
        <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="email-login"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={copy.placeholder}
          value={email}
          onChange={e => {
            setEmail(e.target.value)
            if (error) setError(null)
          }}
          aria-invalid={error ? true : undefined}
          className="h-12 pl-9"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        type="submit"
        variant="theme"
        className="h-12 w-full"
        disabled={sending || !email.trim()}
      >
        {sending ? (
          <>
            <Spinner size={16} />
            {copy.sending}
          </>
        ) : (
          copy.submit
        )}
      </Button>
    </form>
  )
}
