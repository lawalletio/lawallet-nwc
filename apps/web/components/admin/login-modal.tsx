'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
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
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useIsMobile } from '@/components/ui/use-mobile'
import { cn } from '@/lib/utils'
import { useAuth, type LoginMethod } from '@/components/admin/auth-context'
import {
  createNsecSigner,
  createBrowserSigner,
  createBunkerSigner,
  createNostrConnectSigner,
  hasBrowserExtension,
} from '@/lib/client/nostr-signer'
import { PasskeyLoginButton } from '@/components/shared/passkey-login-button'
import { isPasskeySupported } from '@/lib/client/passkey-api'
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

export function LoginModal({ open, onOpenChange, onSuccess }: LoginModalProps) {
  const dismissible = !!onOpenChange
  const [bunkerBusy, setBunkerBusy] = useState(false)
  // WebAuthn support is stable for the page's lifetime; unsupported browsers
  // see the original three-tab layout untouched.
  const [passkeySupported] = useState(() => isPasskeySupported())

  return (
    <Dialog open={open} onOpenChange={dismissible ? onOpenChange : undefined}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => {
          if (!dismissible) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (!dismissible) e.preventDefault()
        }}
        aria-describedby="login-description"
      >
        <DialogHeader>
          <DialogTitle className="text-center">Connect to LaWallet</DialogTitle>
          <DialogDescription id="login-description" className="text-center">
            Sign in to access the admin dashboard.
          </DialogDescription>
        </DialogHeader>

        {passkeySupported ? (
          // Two top-level methods: Nostr (extension / secret key / bunker) and
          // Passkey. Hidden entirely while the bunker QR is connecting so the
          // QR gets the full dialog.
          <Tabs defaultValue="nostr" className="w-full">
            {!bunkerBusy && (
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="nostr">
                  <KeyRound className="mr-1.5 size-4" />
                  Nostr
                </TabsTrigger>
                <TabsTrigger value="passkey">
                  <Fingerprint className="mr-1.5 size-4" />
                  Passkey
                </TabsTrigger>
              </TabsList>
            )}

            <TabsContent value="nostr">
              <NostrMethods
                bunkerBusy={bunkerBusy}
                onBunkerBusyChange={setBunkerBusy}
              />
            </TabsContent>
            <TabsContent value="passkey">
              <PasskeyTab />
            </TabsContent>
          </Tabs>
        ) : (
          // No WebAuthn support — Nostr is the only method, so skip the
          // redundant top-level wrapper and show its sub-tabs directly.
          <NostrMethods
            bunkerBusy={bunkerBusy}
            onBunkerBusyChange={setBunkerBusy}
          />
        )}
      </DialogContent>
    </Dialog>
  )
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
}: {
  bunkerBusy: boolean
  onBunkerBusyChange: (busy: boolean) => void
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
            extensionAvailable ? 'grid-cols-3' : 'grid-cols-2',
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
    </Tabs>
  )
}

// ─── Extension Tab (NIP-07) ────────────────────────────────────────────────

// Only rendered once `useBrowserExtensionDetected()` has found `window.nostr`,
// so there's no "no extension" fallback state here.
function ExtensionTab() {
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)

  async function handleConnect() {
    setLoading(true)
    trackEvent(AnalyticsEvent.LOGIN_STARTED, { method: 'extension' })
    try {
      const signer = createBrowserSigner()
      await login(signer, 'extension')
    } catch (error) {
      trackEvent(AnalyticsEvent.LOGIN_FAILED, { method: 'extension' })
      toast.error(error instanceof Error ? error.message : 'Failed to connect with extension')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-4">
      <p className="text-sm text-muted-foreground">
        Connect using a Nostr browser extension like Alby, nos2x, or Nostr Connect.
      </p>

      <Button onClick={handleConnect} disabled={loading} className="w-full">
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
            onChange={(e) => {
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
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-yellow-500" />
        <p className="text-xs text-muted-foreground">
          Your key is used locally for signing and is <strong>never sent to the server</strong>.
          For better security, consider using a browser extension or NsecBunker.
        </p>
      </div>

      <Button type="submit" disabled={!nsec.trim() || loading} className="w-full">
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

function BunkerTab({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
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
  onStatusChange,
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
        onURI: (generatedUri) => {
          setUri(generatedUri)
          setStatus('waiting')
        },
      })

      if (controller.signal.aborted) return

      setStatus('connecting')
      await login(signer, 'bunker')
    } catch (err) {
      if (controller.signal.aborted) return
      trackEvent(AnalyticsEvent.LOGIN_FAILED, { method: 'bunker', flow: 'qr' })
      const message = err instanceof Error ? err.message : 'Failed to connect'
      setError(message.includes('timed out') || message.includes('abort')
        ? 'Connection timed out. Make sure your signer app scanned the QR code.'
        : message)
      setStatus('error')
    }
  }, [login])

  useEffect(() => {
    const id = requestAnimationFrame(() => startConnection())
    return () => { cancelAnimationFrame(id); abortRef.current?.abort() }
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
        <p className="text-sm text-muted-foreground">Generating connection...</p>
      </div>
    )
  }

  if (status === 'connecting') {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <Spinner size={24} />
        <p className="text-sm text-muted-foreground">Signer connected, logging in...</p>
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
        <a href="https://nsec.app" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
          nsec.app
        </a>
        , Amber, etc.)
      </p>
    </div>
  )
}

// ─── Bunker Paste Mode (bunker://) ────────────────────────────────────────

function BunkerPasteMode({
  onLoadingChange,
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
    trackEvent(AnalyticsEvent.LOGIN_STARTED, { method: 'bunker', flow: 'paste' })
    try {
      const signer = await createBunkerSigner(bunkerUrl, { timeout: 30_000 })
      await login(signer, 'bunker')
    } catch (err) {
      trackEvent(AnalyticsEvent.LOGIN_FAILED, { method: 'bunker', flow: 'paste' })
      const message = err instanceof Error ? err.message : 'Failed to connect to bunker'
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
          onChange={(e) => {
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

      <Button type="submit" disabled={!bunkerUrl.trim() || loading} className="w-full">
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

// ─── Passkey Tab (WebAuthn) ────────────────────────────────────────────────

function PasskeyTab() {
  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm text-muted-foreground">
        Sign in with the passkey you created on this instance — Face ID, Touch
        ID, or your device screen lock. No keys to paste.
      </p>
      <PasskeyLoginButton
        mode="authenticate"
        className="h-11 w-full"
        showCrossDeviceHint
      />
    </div>
  )
}
