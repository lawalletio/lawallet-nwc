'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  CircleCheck,
  Globe,
  LogIn,
  ShieldAlert
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { BrandLogotype } from '@/components/ui/brand-logotype'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CheckboxCard } from '@/components/ui/checkbox-card'
import { Fieldset, FieldsetLegend } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { LoginModal } from '@/components/admin/login-modal'
import { Role } from '@/lib/auth/permissions'
import { npubInitials, truncateNpub } from '@/lib/client/format'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import {
  checkAuthorizeRequest,
  submitAuthorizeDecision,
  type AuthorizeRequestCheck,
  type AuthorizeRequestDetails
} from '@/lib/client/oauth-api'
import {
  DEFAULT_OAUTH_SCOPES,
  OAUTH_SCOPES,
  type OAuthScope
} from '@/lib/oauth/constants'
import { cn } from '@/lib/utils'

const SCOPE_COPY: Record<OAuthScope, { label: string; detail: string }> = {
  read: {
    label: 'View balances, addresses, cards and activity',
    detail: "Read-only: it can't change anything."
  },
  write: {
    label: 'Create, change and delete addresses, invoices and cards',
    detail:
      'Includes choosing which of your own wallets receives payments. It cannot send funds.'
  },
  spend: {
    label: 'Send payments from your wallets',
    detail: 'Moves your funds, up to a daily limit you set.'
  }
}

const SWITCH_ACCOUNT_CONFIRM =
  'Sign out to use a different account? If you signed in with a secret key, make sure you have a copy: it is removed from this browser.'

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

const HEADING = 'text-center text-xl font-semibold text-foreground'

// assign() runs a javascript: URL on this origin, where the session lives.
// The server only returns registered redirect URIs whose scheme it vetted;
// this is the backstop at the sink.
function isNavigable(url: string): boolean {
  try {
    return !['javascript:', 'data:', 'vbscript:'].includes(
      new URL(url).protocol
    )
  } catch {
    return false
  }
}

/**
 * `/oauth/authorize` — the OAuth consent screen an MCP client (Claude,
 * ChatGPT, Cursor…) sends the user to. Validates the request, has the user
 * sign in in place (the query string never leaves the URL), then records
 * Approve/Deny and follows the redirect the server returns. An invalid
 * request is shown here and never redirected.
 */
export function ConsentScreen() {
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const { status, logout } = useAuth()
  const [check, setCheck] = useState<AuthorizeRequestCheck | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void checkAuthorizeRequest(query).then(result => {
      if (!cancelled) setCheck(result)
    })
    return () => {
      cancelled = true
    }
  }, [query])

  function switchAccount() {
    if (!window.confirm(SWITCH_ACCOUNT_CONFIRM)) return
    logout()
    setLoginOpen(true)
  }

  let content: ReactNode = <Loading />
  if (check && !check.ok) {
    content = (
      <InvalidRequest error={check.error} description={check.description} />
    )
  } else if (check?.ok && status === 'unauthenticated') {
    content = (
      <SignedOut details={check.details} onSignIn={() => setLoginOpen(true)} />
    )
  } else if (check?.ok && status === 'authenticated') {
    content = (
      <ConsentForm
        details={check.details}
        search={searchParams}
        onSwitchAccount={switchAccount}
      />
    )
  }

  return (
    <ConsentCard>
      {content}
      <LoginModal
        open={loginOpen && status === 'unauthenticated'}
        onOpenChange={setLoginOpen}
      />
    </ConsentCard>
  )
}

/** Suspense fallback for the page while `useSearchParams` resolves. */
export function ConsentFallback() {
  return (
    <ConsentCard>
      <Loading />
    </ConsentCard>
  )
}

function ConsentCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col px-4 py-8">
      {/* my-auto centres the card without clipping it on short screens */}
      <Card className="mx-auto my-auto flex w-full max-w-md flex-col gap-5 bg-card p-6">
        <div className="flex justify-center">
          <BrandLogotype width={128} height={28} className="h-7" />
        </div>
        {children}
      </Card>
    </main>
  )
}

function Loading() {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-8">
      <Spinner size={24} />
      <p className="text-sm text-muted-foreground">Checking the request…</p>
    </div>
  )
}

function InvalidRequest({
  error,
  description
}: {
  error: string | null
  description: string
}) {
  return (
    <>
      <h1 className={HEADING}>Can&apos;t connect this app</h1>
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>This request is not valid</AlertTitle>
        <AlertDescription>
          <p className="break-words">{description}</p>
          {error && (
            <p className="mt-1 font-mono text-xs opacity-80">{error}</p>
          )}
        </AlertDescription>
      </Alert>
      <p className="text-center text-sm text-muted-foreground">
        Nothing was authorized. Close this page and start the connection again
        from the app.
      </p>
    </>
  )
}

function SignedOut({
  details,
  onSignIn
}: {
  details: AuthorizeRequestDetails
  onSignIn: () => void
}) {
  return (
    <>
      <h1 className={HEADING}>Connect an app</h1>
      <AppIdentity details={details} />
      <p className="text-sm text-muted-foreground">
        Sign in to see what this app is asking for. Nothing is shared until you
        approve.
      </p>
      <Button type="button" className="w-full" onClick={onSignIn}>
        <LogIn />
        Sign in to continue
      </Button>
    </>
  )
}

/**
 * Who is asking. The redirect host leads because it is where the code goes;
 * the name is whatever the client registered, so it is shown as a claim.
 */
function AppIdentity({ details }: { details: AuthorizeRequestDetails }) {
  const host = details.redirectHost || details.redirectUri
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-background p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Globe className="size-5" />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-muted-foreground">Request from</p>
        <p className="break-all text-base font-semibold text-foreground">
          {host}
        </p>
        <p className="break-words text-xs text-muted-foreground">
          {LOOPBACK_HOST.test(host) && 'Runs on this computer. '}
          Calls itself{' '}
          {/* bdi: a client-chosen name must not reorder the text around it */}
          <bdi className="font-medium text-foreground">
            “{details.client.name}”
          </bdi>
          . Apps pick their own names, so judge it by the address above.
        </p>
      </div>
    </div>
  )
}

function AccountRow({
  onSwitch,
  disabled
}: {
  onSwitch: () => void
  disabled: boolean
}) {
  const { pubkey } = useAuth()
  const { profile } = useNostrProfile(pubkey)
  const npub = pubkey ? truncateNpub(pubkey) : 'Unknown account'
  const name = profile?.displayName || profile?.name

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-9">
          {profile?.picture && <AvatarImage src={profile.picture} alt="" />}
          <AvatarFallback className="text-xs">
            {npubInitials(pubkey)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="truncate text-sm font-medium text-foreground">
            {name || npub}
          </p>
          {name && (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {npub}
            </p>
          )}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={onSwitch}
        disabled={disabled}
      >
        Switch account
      </Button>
    </div>
  )
}

function ConsentForm({
  details,
  search,
  onSwitchAccount
}: {
  details: AuthorizeRequestDetails
  search: URLSearchParams
  onSwitchAccount: () => void
}) {
  const { apiClient, role } = useAuth()
  const [selected, setSelected] = useState<OAuthScope[]>(() =>
    details.scopes.filter(scope => DEFAULT_OAUTH_SCOPES.includes(scope))
  )
  const [limitText, setLimitText] = useState(
    String(details.defaultSpendLimitSats)
  )
  const [pending, setPending] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'approved' | 'denied' | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // After signing in the login dialog's opener is gone, so focus would fall
  // back to <body>; land it on the question instead.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // write and spend both imply read (the server adds it to the grant), so read
  // is always offered and stays ticked and locked while either is chosen.
  const visible = OAUTH_SCOPES.filter(
    scope => scope === 'read' || details.scopes.includes(scope)
  )
  const readLocked = selected.includes('write') || selected.includes('spend')
  const chosen = OAUTH_SCOPES.filter(
    scope => selected.includes(scope) || (scope === 'read' && readLocked)
  )
  const spend = chosen.includes('spend')
  const limit = /^\d+$/.test(limitText) ? Number(limitText) : NaN
  const limitValid = limit >= 1 && limit <= details.maxSpendLimitSats
  const canApprove = chosen.length > 0 && (!spend || limitValid)
  const busy = pending !== null

  function toggle(scope: OAuthScope, checked: boolean) {
    setSelected(prev =>
      checked ? [...prev, scope] : prev.filter(s => s !== scope)
    )
  }

  async function decide(approve: boolean) {
    setPending(approve ? 'approve' : 'deny')
    setError(null)
    try {
      const { redirectTo } = await submitAuthorizeDecision(
        apiClient,
        search,
        approve
          ? {
              approve,
              scopes: chosen,
              ...(spend ? { spendLimitSats: limit } : {})
            }
          : { approve, scopes: [] }
      )
      if (!isNavigable(redirectTo)) {
        throw new Error('The server returned an invalid redirect address.')
      }
      // Custom-scheme redirects (cursor://…) leave this page open, so say
      // what happened instead of spinning forever; the code is single-use.
      setDone(approve ? 'approved' : 'denied')
      window.location.assign(redirectTo)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again.'
      )
      setPending(null)
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 py-6 text-center"
      >
        <CircleCheck className="size-8 text-muted-foreground" />
        <p className="text-base font-medium text-foreground">
          {done === 'approved' ? 'Access approved' : 'Request denied'}
        </p>
        <p className="text-sm text-muted-foreground">
          Returning you to the app. If nothing happens, you can close this page.
        </p>
      </div>
    )
  }

  return (
    <>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className={cn(HEADING, 'outline-none')}
      >
        Allow access to your account?
      </h1>
      <AppIdentity details={details} />
      <AccountRow onSwitch={onSwitchAccount} disabled={busy} />

      <Fieldset className="gap-2">
        <FieldsetLegend className="mb-2 text-sm">
          It will be able to
        </FieldsetLegend>
        {visible.map(scope => {
          const locked = scope === 'read' && readLocked
          return (
            <CheckboxCard
              key={scope}
              checked={chosen.includes(scope)}
              onCheckedChange={checked => toggle(scope, checked)}
              disabled={busy || locked}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {SCOPE_COPY[scope].label}
                  {scope === 'spend' && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-destructive/50 text-destructive"
                    >
                      <ShieldAlert className="size-3" />
                      Sensitive
                    </Badge>
                  )}
                </span>
              }
              description={
                locked
                  ? 'Included with the options below.'
                  : SCOPE_COPY[scope].detail
              }
              className={cn(
                scope === 'spend' &&
                  spend &&
                  'border-destructive/60 bg-destructive/5'
              )}
            />
          )
        })}
      </Fieldset>

      {spend && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
          <Label htmlFor="spend-limit">Daily limit (sats)</Label>
          <Input
            id="spend-limit"
            type="number"
            inputMode="numeric"
            min={1}
            max={details.maxSpendLimitSats}
            step={1}
            required
            value={limitText}
            onChange={e => setLimitText(e.target.value)}
            disabled={busy}
            aria-invalid={!limitValid}
            aria-describedby="spend-limit-hint"
          />
          <p
            id="spend-limit-hint"
            aria-live="polite"
            className={cn(
              'text-xs',
              limitValid ? 'text-muted-foreground' : 'text-destructive'
            )}
          >
            {limitValid
              ? `This app can send up to ${limit.toLocaleString()} sats every 24 hours without asking you again.`
              : `Enter a whole number of sats from 1 to ${details.maxSpendLimitSats.toLocaleString()}.`}
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        The app will act on this LaWallet instance as you
        {role && role !== Role.USER
          ? `, with your ${role.toLowerCase()} permissions`
          : ''}
        . You can revoke access at any time under Connected apps.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Could not complete the request</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        {chosen.length === 0 && (
          <p className="text-center text-xs text-muted-foreground">
            Select at least one option to approve.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => void decide(false)}
            disabled={busy}
          >
            {pending === 'deny' && <Spinner size={16} />}
            Deny
          </Button>
          <Button
            type="button"
            onClick={() => void decide(true)}
            disabled={busy || !canApprove}
          >
            {pending === 'approve' && <Spinner size={16} />}
            Approve
          </Button>
        </div>
      </div>
    </>
  )
}
