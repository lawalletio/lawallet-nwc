'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Key,
  KeyRound,
  Globe,
  Plug,
  Eye,
  EyeOff,
  AlertTriangle,
  Fingerprint,
  QrCode,
  Copy,
  Link,
  RefreshCw,
  Smartphone,
  ChevronLeft,
  ChevronRight,
  Sparkles
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { generateSecretKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useIsMobile } from '@/components/ui/use-mobile'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/admin/auth-context'
import {
  createNsecSigner,
  createBrowserSigner,
  createBunkerSigner,
  createNostrConnectSigner,
  hasBrowserExtension
} from '@/lib/client/nostr-signer'
import { PasskeyLoginButton } from '@/components/shared/passkey-login-button'
import { isPasskeySupported } from '@/lib/client/passkey-api'
import { SecretKeyReveal } from '@/components/shared/secret-key-reveal'
import { BrandLogotype } from '@/components/ui/brand-logotype'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

interface LoginModalProps {
  open: boolean
  /** When provided, the dialog is dismissible (used on landing page). */
  onOpenChange?: (open: boolean) => void
  /** Called after successful login. Use for redirect, etc. */
  onSuccess?: () => void
}

type BunkerConnectionStatus = 'generating' | 'waiting' | 'connecting' | 'error'

/**
 * Login wizard steps. `choose` is the two-method picker; the rest are each
 * method's own screen. When WebAuthn is unavailable Nostr is the only method,
 * so we skip `choose` and open straight on `nostr`.
 */
type Step = 'choose' | 'nostr' | 'nostr-create' | 'passkey'

const STEP_DESCRIPTIONS: Record<Step, string> = {
  choose: 'Choose how to sign in.',
  nostr: 'Sign in with a Nostr key.',
  'nostr-create': 'We generated a new key for you.',
  passkey: 'Use a passkey — Face ID, Touch ID, or your screen lock.'
}

export function LoginModal({ open, onOpenChange, onSuccess }: LoginModalProps) {
  const dismissible = !!onOpenChange
  const [bunkerBusy, setBunkerBusy] = useState(false)
  // WebAuthn support is stable for the page's lifetime; unsupported browsers
  // never see the Passkey method and open straight on the Nostr step.
  const [passkeySupported] = useState(() => isPasskeySupported())
  const initialStep: Step = passkeySupported ? 'choose' : 'nostr'
  const [step, setStep] = useState<Step>(initialStep)

  // The landing page keeps this modal mounted and toggles `open`; reset to the
  // first screen whenever it reopens so it never resurfaces mid-flow.
  // Adjusting state during render (React's recommended pattern for resetting on
  // a prop change) avoids the post-paint flash a reset effect would cause.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setStep(initialStep)
      setBunkerBusy(false)
    }
  }

  // Back target: the two method screens return to the picker; the nsec
  // generator returns to the Nostr screen. No back on the initial step, and
  // never while the bunker QR is mid-connection.
  const backTo: Step | null =
    step === 'nostr-create' ? 'nostr' : step === initialStep ? null : 'choose'
  const showBack = backTo !== null && !bunkerBusy

  return (
    <Dialog open={open} onOpenChange={dismissible ? onOpenChange : undefined}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={e => {
          if (!dismissible) e.preventDefault()
        }}
        onEscapeKeyDown={e => {
          if (!dismissible) e.preventDefault()
        }}
        aria-describedby="login-description"
      >
        {showBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => backTo && setStep(backTo)}
            aria-label="Back"
            className="absolute left-3 top-3 size-8 rounded-full text-muted-foreground"
          >
            <ChevronLeft className="size-4" />
          </Button>
        )}

        <DialogHeader className="items-center">
          <BrandLogotype width={128} height={28} className="mb-1 h-7" />
          <DialogTitle className="text-center text-xl">
            Connect to LaWallet
          </DialogTitle>
          <DialogDescription id="login-description" className="text-center">
            {STEP_DESCRIPTIONS[step]}
          </DialogDescription>
        </DialogHeader>

        {step === 'choose' && (
          <ChooseMethodStep
            passkeySupported={passkeySupported}
            onPick={setStep}
          />
        )}
        {step === 'nostr' && (
          <NostrMethods
            bunkerBusy={bunkerBusy}
            onBunkerBusyChange={setBunkerBusy}
            onCreateNew={() => setStep('nostr-create')}
          />
        )}
        {step === 'nostr-create' && <NostrCreateStep />}
        {step === 'passkey' && <PasskeyTab />}
      </DialogContent>
    </Dialog>
  )
}

// ─── Step 1 · Choose method ────────────────────────────────────────────────

function ChooseMethodStep({
  passkeySupported,
  onPick
}: {
  passkeySupported: boolean
  onPick: (step: Step) => void
}) {
  const extensionAvailable = useBrowserExtensionDetected()
  const { connect, loading } = useExtensionLogin()

  return (
    <div className="flex flex-col gap-3 pt-2">
      <MethodButton
        icon={<KeyRound />}
        title="Nostr"
        subtitle="Secret key, bunker, or a new key"
        onClick={() => onPick('nostr')}
      />

      {passkeySupported && (
        <MethodButton
          icon={<Fingerprint />}
          title="Passkey"
          subtitle="Syncs across your devices"
          onClick={() => onPick('passkey')}
        />
      )}

      {extensionAvailable && (
        <>
          <div className="flex items-center gap-3 pt-1">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
          <Button
            variant="theme"
            onClick={connect}
            disabled={loading}
            className="h-11 w-full"
          >
            {loading ? (
              <>
                <Spinner size={16} />
                Connecting...
              </>
            ) : (
              <>
                <Globe />
                Continue with extension
              </>
            )}
          </Button>
        </>
      )}
    </div>
  )
}

/**
 * A branded method row for the picker: a filled `secondary` button with the
 * icon in a LaWallet-green chip, a title/subtitle, and a forward chevron —
 * proper button-component styling instead of a flat outline card.
 */
function MethodButton({
  icon,
  title,
  subtitle,
  onClick
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      // whitespace-normal overrides the button base's `whitespace-nowrap`, and
      // min-w-0 lets the label shrink — otherwise a long subtitle's no-wrap
      // min-content stretches the dialog's grid track past its padding and
      // pushes every row off-centre on wide viewports.
      className="h-auto w-full justify-between gap-3 whitespace-normal px-3 py-3 text-left"
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-green-500/10 text-green-400">
          {icon}
        </span>
        <span className="flex min-w-0 flex-col items-start">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {subtitle}
          </span>
        </span>
      </span>
      <ChevronRight className="shrink-0 text-muted-foreground" />
    </Button>
  )
}

/**
 * Shared connect handler for a detected NIP-07 extension, reused by both the
 * step-1 shortcut and the Extension sub-tab under Nostr.
 */
function useExtensionLogin() {
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)

  const connect = useCallback(async () => {
    setLoading(true)
    trackEvent(AnalyticsEvent.LOGIN_STARTED, { method: 'extension' })
    try {
      const signer = createBrowserSigner()
      await login(signer, 'extension')
    } catch (error) {
      trackEvent(AnalyticsEvent.LOGIN_FAILED, { method: 'extension' })
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to connect with extension'
      )
    } finally {
      setLoading(false)
    }
  }, [login])

  return { connect, loading }
}

// ─── Nostr methods (extension / secret key / bunker) ───────────────────────

/**
 * Polls for a NIP-07 browser extension. Some extensions inject `window.nostr`
 * asynchronously, so we re-check for a few seconds after mount. The Extension
 * sub-tab is only shown once one is detected.
 */
function useBrowserExtensionDetected(): boolean {
  const [detected, setDetected] = useState(() => hasBrowserExtension())

  useEffect(() => {
    if (detected) return

    const interval = setInterval(() => {
      if (hasBrowserExtension()) {
        setDetected(true)
        clearInterval(interval)
      }
    }, 500)
    const timeout = setTimeout(() => clearInterval(interval), 5000)

    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [detected])

  return detected
}

function NostrMethods({
  bunkerBusy,
  onBunkerBusyChange,
  onCreateNew
}: {
  bunkerBusy: boolean
  onBunkerBusyChange: (busy: boolean) => void
  onCreateNew: () => void
}) {
  const extensionAvailable = useBrowserExtensionDetected()

  return (
    <Tabs
      // Default to the extension when one is present, otherwise the secret key.
      defaultValue={extensionAvailable ? 'extension' : 'nsec'}
      className="w-full"
    >
      {!bunkerBusy && (
        <TabsList
          className={cn(
            'mt-3 grid w-full',
            extensionAvailable ? 'grid-cols-3' : 'grid-cols-2'
          )}
        >
          {extensionAvailable && (
            <TabsTrigger value="extension" className="text-xs">
              <Globe className="mr-1 size-3.5" />
              Extension
            </TabsTrigger>
          )}
          <TabsTrigger value="nsec" className="text-xs">
            <Key className="mr-1 size-3.5" />
            Secret Key
          </TabsTrigger>
          <TabsTrigger value="bunker" className="text-xs">
            <Plug className="mr-1 size-3.5" />
            Bunker
          </TabsTrigger>
        </TabsList>
      )}

      {extensionAvailable && (
        <TabsContent value="extension">
          <ExtensionTab />
        </TabsContent>
      )}
      <TabsContent value="nsec">
        <NsecTab />
      </TabsContent>
      <TabsContent value="bunker">
        <BunkerTab onBusyChange={onBunkerBusyChange} />
      </TabsContent>

      {/* Symmetric with the Passkey step's "New here?" — a first-class path to
          mint a fresh Nostr key. Hidden during the bunker QR takeover. */}
      {!bunkerBusy && (
        <div className="mt-4">
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">New to Nostr?</span>
            <Separator className="flex-1" />
          </div>
          <Button
            variant="outline"
            onClick={onCreateNew}
            className="mt-3 h-11 w-full"
          >
            <Sparkles className="mr-2 size-4" />
            Generate a new key
          </Button>
        </div>
      )}
    </Tabs>
  )
}

// ─── Extension Tab (NIP-07) ────────────────────────────────────────────────

// Only rendered once `useBrowserExtensionDetected()` has found `window.nostr`,
// so there's no "no extension" fallback state here.
function ExtensionTab() {
  const { connect, loading } = useExtensionLogin()

  return (
    <div className="flex flex-col gap-4 pt-4">
      <p className="text-sm text-muted-foreground">
        Connect using a Nostr browser extension like Alby, nos2x, or Nostr
        Connect.
      </p>

      <Button onClick={connect} disabled={loading} className="w-full">
        {loading ? (
          <>
            <Spinner size={16} className="mr-2" />
            Connecting...
          </>
        ) : (
          <>
            <Globe className="mr-2 size-4" />
            Connect with Extension
          </>
        )}
      </Button>
    </div>
  )
}

// ─── Nsec Tab ──────────────────────────────────────────────────────────────

function NsecTab() {
  const { login } = useAuth()
  const [nsec, setNsec] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    trackEvent(AnalyticsEvent.LOGIN_STARTED, { method: 'nsec' })

    try {
      const signer = createNsecSigner(nsec)
      await login(signer, 'nsec')
    } catch (err) {
      trackEvent(AnalyticsEvent.LOGIN_FAILED, { method: 'nsec' })
      const message = err instanceof Error ? err.message : 'Failed to login'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="nsec-input">Private Key (nsec or hex)</Label>
        <div className="relative">
          <Input
            id="nsec-input"
            type={showKey ? 'text' : 'password'}
            placeholder="nsec or hex private key..."
            value={nsec}
            onChange={e => {
              setNsec(e.target.value)
              setError(null)
            }}
            className={cn('pr-10', error && 'border-destructive')}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showKey ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-yellow-500" />
        <p className="text-xs text-muted-foreground">
          Your key is used locally for signing and is{' '}
          <strong>never sent to the server</strong>. For better security,
          consider using a browser extension or NsecBunker.
        </p>
      </div>

      <Button
        type="submit"
        disabled={!nsec.trim() || loading}
        className="w-full"
      >
        {loading ? (
          <>
            <Spinner size={16} className="mr-2" />
            Signing in...
          </>
        ) : (
          <>
            <Key className="mr-2 size-4" />
            Sign In
          </>
        )}
      </Button>
    </form>
  )
}

// ─── Bunker Tab (NIP-46) ──────────────────────────────────────────────────

function BunkerTab({
  onBusyChange
}: {
  onBusyChange?: (busy: boolean) => void
}) {
  const [mode, setMode] = useState<'qr' | 'paste'>('qr')
  const [qrStatus, setQrStatus] = useState<BunkerConnectionStatus>('generating')
  const [pasteLoading, setPasteLoading] = useState(false)
  const busy = pasteLoading || (mode === 'qr' && qrStatus === 'connecting')

  useEffect(() => {
    onBusyChange?.(busy)
    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])

  return (
    <div className="flex flex-col gap-4 pt-4">
      {!busy && (
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setMode('qr')}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              mode === 'qr'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <QrCode className="mr-1.5 inline size-3.5" />
            Show QR
          </button>
          <button
            type="button"
            onClick={() => setMode('paste')}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              mode === 'paste'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Link className="mr-1.5 inline size-3.5" />
            Paste URL
          </button>
        </div>
      )}

      {mode === 'qr' ? (
        <BunkerQRMode onStatusChange={setQrStatus} />
      ) : (
        <BunkerPasteMode onLoadingChange={setPasteLoading} />
      )}
    </div>
  )
}

// ─── Bunker QR Mode (nostrconnect://) ─────────────────────────────────────

function BunkerQRMode({
  onStatusChange
}: {
  onStatusChange?: (status: BunkerConnectionStatus) => void
}) {
  const { login } = useAuth()
  const isMobile = useIsMobile()
  const [uri, setUri] = useState<string | null>(null)
  const [status, setStatus] = useState<BunkerConnectionStatus>('generating')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const startConnection = useCallback(async () => {
    // Abort any existing connection
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setUri(null)
    setError(null)
    setStatus('generating')
    setCopied(false)
    trackEvent(AnalyticsEvent.LOGIN_STARTED, { method: 'bunker', flow: 'qr' })

    try {
      const signer = await createNostrConnectSigner({
        timeout: 60_000,
        signal: controller.signal,
        onURI: generatedUri => {
          setUri(generatedUri)
          setStatus('waiting')
        }
      })

      if (controller.signal.aborted) return

      setStatus('connecting')
      await login(signer, 'bunker')
    } catch (err) {
      if (controller.signal.aborted) return
      trackEvent(AnalyticsEvent.LOGIN_FAILED, { method: 'bunker', flow: 'qr' })
      const message = err instanceof Error ? err.message : 'Failed to connect'
      setError(
        message.includes('timed out') || message.includes('abort')
          ? 'Connection timed out. Make sure your signer app scanned the QR code.'
          : message
      )
      setStatus('error')
    }
  }, [login])

  useEffect(() => {
    const id = requestAnimationFrame(() => startConnection())
    return () => {
      cancelAnimationFrame(id)
      abortRef.current?.abort()
    }
  }, [startConnection])

  useEffect(() => {
    onStatusChange?.(status)
  }, [onStatusChange, status])

  async function handleCopy() {
    if (!uri) return
    await navigator.clipboard.writeText(uri)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (status === 'generating') {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <Spinner size={24} />
        <p className="text-sm text-muted-foreground">
          Generating connection...
        </p>
      </div>
    )
  }

  if (status === 'connecting') {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <Spinner size={24} />
        <p className="text-sm text-muted-foreground">
          Signer connected, logging in...
        </p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <p className="text-sm text-destructive text-center">{error}</p>
        <Button variant="outline" size="sm" onClick={startConnection}>
          <RefreshCw className="mr-2 size-3.5" />
          Try Again
        </Button>
      </div>
    )
  }

  // status === 'waiting'
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-lg bg-white p-3">
        <QRCodeSVG value={uri!} size={200} />
      </div>

      <div className="flex w-full flex-col gap-2 sm:flex-row">
        {isMobile && (
          <Button
            asChild
            className="flex-1 bg-amber-400 text-black hover:bg-amber-300"
          >
            <a href={uri!}>
              <Smartphone className="mr-2 size-4" />
              Login with Amber
            </a>
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="flex-1 text-xs"
        >
          <Copy className="mr-1.5 size-3.5" />
          {copied ? 'Copied!' : 'Copy URI'}
        </Button>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner size={12} />
        Waiting for signer to connect...
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Scan with your signer app (
        <a
          href="https://nsec.app"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          nsec.app
        </a>
        , Amber, etc.)
      </p>
    </div>
  )
}

// ─── Bunker Paste Mode (bunker://) ────────────────────────────────────────

function BunkerPasteMode({
  onLoadingChange
}: {
  onLoadingChange?: (loading: boolean) => void
}) {
  const { login } = useAuth()
  const [bunkerUrl, setBunkerUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!bunkerUrl.startsWith('bunker://')) {
      setError('URL must start with bunker://')
      return
    }

    setLoading(true)
    onLoadingChange?.(true)
    trackEvent(AnalyticsEvent.LOGIN_STARTED, {
      method: 'bunker',
      flow: 'paste'
    })
    try {
      const signer = await createBunkerSigner(bunkerUrl, { timeout: 30_000 })
      await login(signer, 'bunker')
    } catch (err) {
      trackEvent(AnalyticsEvent.LOGIN_FAILED, {
        method: 'bunker',
        flow: 'paste'
      })
      const message =
        err instanceof Error ? err.message : 'Failed to connect to bunker'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
      onLoadingChange?.(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="bunker-input">Bunker URL</Label>
        <Input
          id="bunker-input"
          type="text"
          placeholder="bunker://..."
          value={bunkerUrl}
          onChange={e => {
            setBunkerUrl(e.target.value)
            setError(null)
          }}
          className={cn(error && 'border-destructive')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={loading}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <p className="text-xs text-muted-foreground">
        Get a bunker URL from your{' '}
        <a
          href="https://nsec.app"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          NsecBunker
        </a>{' '}
        provider.
      </p>

      <Button
        type="submit"
        disabled={!bunkerUrl.trim() || loading}
        className="w-full"
      >
        {loading ? (
          <>
            <Spinner size={16} className="mr-2" />
            Connecting to bunker...
          </>
        ) : (
          <>
            <Plug className="mr-2 size-4" />
            Connect
          </>
        )}
      </Button>
    </form>
  )
}

// ─── Step 2a′ · Generate a new Nostr key ───────────────────────────────────

/**
 * Generates a fresh nsec client-side, makes the user reveal + acknowledge it,
 * then runs the standard NIP-98 → JWT login. Mirrors the wallet's
 * create-account flow; the key never leaves the browser. No redirect here —
 * the admin surfaces react to the auth-context status flip (same as every
 * other method in this modal).
 */
function NostrCreateStep() {
  const { login } = useAuth()
  const { nsec, hex } = useMemo(() => {
    const secretKey = generateSecretKey()
    return {
      nsec: nip19.nsecEncode(secretKey),
      hex: bytesToHex(secretKey)
    }
  }, [])

  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleContinue() {
    setError(null)
    setLoading(true)
    trackEvent(AnalyticsEvent.LOGIN_STARTED, { method: 'nsec', flow: 'create' })
    try {
      const signer = createNsecSigner(hex)
      // Persist the nsec so reloads silently rebuild the signer.
      await login(signer, 'nsec', { secret: nsec })
    } catch (err) {
      trackEvent(AnalyticsEvent.LOGIN_FAILED, {
        method: 'nsec',
        flow: 'create'
      })
      const message =
        err instanceof Error ? err.message : 'Failed to create account'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-yellow-500" />
        <p className="text-xs text-muted-foreground">
          Save this key somewhere safe — it&apos;s the only way back into your
          account and is <strong>never sent to the server</strong>.
        </p>
      </div>

      <SecretKeyReveal
        nsec={nsec}
        disabled={loading}
        confirmed={confirmed}
        onConfirmedChange={setConfirmed}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button
        type="button"
        onClick={handleContinue}
        disabled={!confirmed || loading}
        className="w-full"
      >
        {loading ? (
          <>
            <Spinner size={16} className="mr-2" />
            Creating account...
          </>
        ) : (
          'Continue'
        )}
      </Button>
    </div>
  )
}

// ─── Passkey Tab (WebAuthn) ────────────────────────────────────────────────

function PasskeyTab() {
  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm text-muted-foreground">
        Sign in with your passkey — it syncs across your devices through iCloud
        Keychain or Google Password Manager. Use Face ID, Touch ID, or your
        screen lock; no keys to paste.
      </p>
      <PasskeyLoginButton
        mode="authenticate"
        className="h-11 w-full"
        showCrossDeviceHint
      />

      {/* First-time visitors have no passkey to sign in with — this is the
          only entry point on the admin surface (the wallet has its own
          /wallet/create-passkey flow). Creating one derives a fresh Nostr
          identity from the passkey; claiming root then happens through the
          setup wizard as usual. */}
      <div className="flex items-center gap-3 pt-1">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">New here?</span>
        <Separator className="flex-1" />
      </div>
      <PasskeyLoginButton
        mode="register"
        variant="outline"
        label="Create a passkey account"
        className="h-11 w-full"
      />
    </div>
  )
}
