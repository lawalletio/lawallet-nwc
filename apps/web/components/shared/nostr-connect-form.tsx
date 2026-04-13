'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Eye, EyeOff, Puzzle, QrCode, Copy, Link, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
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

interface NostrConnectFormProps {
  /** Called after successful login */
  onSuccess?: () => void
  /** Button labels */
  submitLabel?: string
  loadingLabel?: string
}

export function NostrConnectForm({
  onSuccess,
  submitLabel = 'Login',
  loadingLabel = 'Signing in...',
}: NostrConnectFormProps) {
  const [extensionAvailable] = useState(() => hasBrowserExtension())

  return (
    <div className="w-full space-y-6">
      {/* Tabs: Private key / Bunker */}
      <Tabs defaultValue="nsec" className="w-full">
        <TabsList className="h-auto w-full bg-transparent p-0 border-b border-border rounded-none">
          <TabsTrigger
            value="nsec"
            className="flex-1 rounded-none bg-transparent py-4 text-sm data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b data-[state=active]:border-primary"
          >
            Private key
          </TabsTrigger>
          <TabsTrigger
            value="bunker"
            className="flex-1 rounded-none bg-transparent py-4 text-sm data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b data-[state=active]:border-primary"
          >
            Bunker
          </TabsTrigger>
        </TabsList>

        <TabsContent value="nsec">
          <NsecForm onSuccess={onSuccess} submitLabel={submitLabel} loadingLabel={loadingLabel} />
        </TabsContent>
        <TabsContent value="bunker">
          <BunkerForm onSuccess={onSuccess} submitLabel={submitLabel} loadingLabel={loadingLabel} />
        </TabsContent>
      </Tabs>

      {extensionAvailable && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>

          <ExtensionButton onSuccess={onSuccess} />
        </>
      )}
    </div>
  )
}

// ─── Private Key Form ──────────────────────────────────────────────────────

function NsecForm({
  onSuccess,
  submitLabel,
  loadingLabel,
}: {
  onSuccess?: () => void
  submitLabel: string
  loadingLabel: string
}) {
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
      onSuccess?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to login'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 pt-4">
      <div className="space-y-2">
        <div className="relative">
          <Input
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

      <Button type="submit" variant="secondary" disabled={!nsec.trim() || loading} className="w-full h-[44px]">
        {loading ? (
          <>
            <Spinner size={16} className="mr-2" />
            {loadingLabel}
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  )
}

// ─── Bunker Form ───────────────────────────────────────────────────────────

function isValidBunkerUrl(url: string): string | null {
  if (!url.startsWith('bunker://')) {
    return 'URL must start with bunker://'
  }
  try {
    const withoutScheme = url.slice('bunker://'.length)
    const [pubkeyPart] = withoutScheme.split('?')
    if (!pubkeyPart || !/^[0-9a-f]{64}$/.test(pubkeyPart)) {
      return 'Invalid bunker URL: missing or invalid public key'
    }
    const params = new URLSearchParams(withoutScheme.split('?')[1] || '')
    if (!params.get('relay')) {
      return 'Invalid bunker URL: missing relay parameter'
    }
  } catch {
    return 'Invalid bunker URL format'
  }
  return null
}

function BunkerForm({
  onSuccess,
  submitLabel,
  loadingLabel,
}: {
  onSuccess?: () => void
  submitLabel: string
  loadingLabel: string
}) {
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

      {mode === 'qr' ? (
        <BunkerQRMode onSuccess={onSuccess} />
      ) : (
        <BunkerPasteMode onSuccess={onSuccess} submitLabel={submitLabel} loadingLabel={loadingLabel} />
      )}
    </div>
  )
}

// ─── Bunker QR Mode (nostrconnect://) ─────────────────────────────────────

function BunkerQRMode({ onSuccess }: { onSuccess?: () => void }) {
  const { login } = useAuth()
  const [uri, setUri] = useState<string | null>(null)
  const [status, setStatus] = useState<'generating' | 'waiting' | 'connecting' | 'error'>('generating')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const startConnection = useCallback(async () => {
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
      onSuccess?.()
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : 'Failed to connect'
      setError(message.includes('timed out') || message.includes('abort')
        ? 'Connection timed out. Make sure your signer app scanned the QR code.'
        : message)
      setStatus('error')
    }
  }, [login, onSuccess])

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

function BunkerPasteMode({
  onSuccess,
  submitLabel,
  loadingLabel,
}: {
  onSuccess?: () => void
  submitLabel: string
  loadingLabel: string
}) {
  const { login } = useAuth()
  const [bunkerUrl, setBunkerUrl] = useState('')
  const [showUrl, setShowUrl] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const validationError = isValidBunkerUrl(bunkerUrl)
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    try {
      const signer = await createBunkerSigner(bunkerUrl, { timeout: 30_000 })
      await login(signer, 'bunker')
      onSuccess?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to bunker'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="space-y-2">
        <div className="relative">
          <Input
            type={showUrl ? 'text' : 'password'}
            placeholder="bunker://..."
            value={bunkerUrl}
            onChange={(e) => {
              setBunkerUrl(e.target.value)
              setError(null)
            }}
            className={cn('pr-10', error && 'border-destructive')}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => setShowUrl(!showUrl)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showUrl ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <Button type="submit" variant="secondary" disabled={!bunkerUrl.trim() || loading} className="w-full h-[44px]">
        {loading ? (
          <>
            <Spinner size={16} className="mr-2" />
            {loadingLabel}
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  )
}

// ─── Extension Button ──────────────────────────────────────────────────────

function ExtensionButton({ onSuccess }: { onSuccess?: () => void }) {
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)

  async function handleConnect() {
    setLoading(true)
    try {
      const signer = createBrowserSigner()
      await login(signer, 'extension')
      onSuccess?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to connect with extension')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      onClick={handleConnect}
      disabled={loading}
      className="w-full h-[52px]"
    >
      {loading ? (
        <>
          <Spinner size={16} className="mr-2" />
          Connecting...
        </>
      ) : (
        <>
          <Puzzle className="mr-2 size-4" />
          With extension
        </>
      )}
    </Button>
  )
}
