'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Key, Globe, Plug, Eye, EyeOff, AlertTriangle, QrCode, Copy, Link, RefreshCw } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { useAuth, type LoginMethod } from '@/components/admin/auth-context'
import {
  createNsecSigner,
  createBrowserSigner,
  createBunkerSigner,
  createNostrConnectSigner,
  hasBrowserExtension,
} from '@/lib/client/nostr-signer'

interface LoginModalProps {
  open: boolean
  /** When provided, the dialog is dismissible (used on landing page). */
  onOpenChange?: (open: boolean) => void
  /** Called after successful login. Use for redirect, etc. */
  onSuccess?: () => void
}

export function LoginModal({ open, onOpenChange, onSuccess }: LoginModalProps) {
  const dismissible = !!onOpenChange

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
            Sign in with your Nostr identity to access the admin dashboard.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="extension" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="extension" className="text-xs">
              <Globe className="mr-1.5 size-3.5" />
              Extension
            </TabsTrigger>
            <TabsTrigger value="nsec" className="text-xs">
              <Key className="mr-1.5 size-3.5" />
              Secret Key
            </TabsTrigger>
            <TabsTrigger value="bunker" className="text-xs">
              <Plug className="mr-1.5 size-3.5" />
              Bunker
            </TabsTrigger>
          </TabsList>

          <TabsContent value="extension">
            <ExtensionTab />
          </TabsContent>
          <TabsContent value="nsec">
            <NsecTab />
          </TabsContent>
          <TabsContent value="bunker">
            <BunkerTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// ─── Extension Tab (NIP-07) ────────────────────────────────────────────────

function ExtensionTab() {
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)
  const [available, setAvailable] = useState(false)

  // Poll for extension availability (some inject asynchronously)
  useEffect(() => {
    if (hasBrowserExtension()) {
      setAvailable(true)
      return
    }

    const interval = setInterval(() => {
      if (hasBrowserExtension()) {
        setAvailable(true)
        clearInterval(interval)
      }
    }, 500)

    // Stop polling after 5 seconds
    const timeout = setTimeout(() => clearInterval(interval), 5000)

    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [])

  async function handleConnect() {
    setLoading(true)
    try {
      const signer = createBrowserSigner()
      await login(signer, 'extension')
    } catch (error) {
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

      <Button
        onClick={handleConnect}
        disabled={!available || loading}
        className="w-full"
      >
        {loading ? (
          <>
            <Spinner size={16} className="mr-2" />
            Connecting...
          </>
        ) : available ? (
          <>
            <Globe className="mr-2 size-4" />
            Connect with Extension
          </>
        ) : (
          'No extension detected'
        )}
      </Button>

      {!available && (
        <p className="text-xs text-muted-foreground text-center">
          Install a{' '}
          <a
            href="https://getalby.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Nostr browser extension
          </a>{' '}
          to use this method.
        </p>
      )}
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

    try {
      const signer = createNsecSigner(nsec)
      await login(signer, 'nsec')
    } catch (err) {
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

function BunkerTab() {
  const [mode, setMode] = useState<'qr' | 'paste'>('qr')

  return (
    <div className="flex flex-col gap-4 pt-4">
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

      {mode === 'qr' ? <BunkerQRMode /> : <BunkerPasteMode />}
    </div>
  )
}

// ─── Bunker QR Mode (nostrconnect://) ─────────────────────────────────────

function BunkerQRMode() {
  const { login } = useAuth()
  const [uri, setUri] = useState<string | null>(null)
  const [status, setStatus] = useState<'generating' | 'waiting' | 'connecting' | 'error'>('generating')
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

      <Button variant="ghost" size="sm" onClick={handleCopy} className="text-xs">
        <Copy className="mr-1.5 size-3.5" />
        {copied ? 'Copied!' : 'Copy URI'}
      </Button>

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

function BunkerPasteMode() {
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
    try {
      const signer = await createBunkerSigner(bunkerUrl, { timeout: 30_000 })
      await login(signer, 'bunker')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to bunker'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
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
