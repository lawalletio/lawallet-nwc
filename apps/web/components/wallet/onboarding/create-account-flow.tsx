'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Eye, EyeOff, Check } from 'lucide-react'
import { toast } from 'sonner'
import { generateSecretKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { createNsecSigner } from '@/lib/client/nostr-signer'
import { cn } from '@/lib/utils'

/**
 * Two-step create-account flow:
 *   1. Generate a fresh nsec client-side, require the user to reveal + copy
 *      it, check "I've saved it", then sign in.
 *   2. On submit, wrap the nsec in an NsecSigner and run the full NIP-98 →
 *      JWT login, then push to `/wallet/create-account/community`.
 *
 * The key never leaves the browser — we never send it to the server.
 */
export function CreateAccountFlow() {
  const router = useRouter()
  const { login } = useAuth()

  const { nsec, hex } = useMemo(() => {
    const secretKey = generateSecretKey()
    return {
      nsec: nip19.nsecEncode(secretKey),
      hex: bytesToHex(secretKey),
    }
  }, [])

  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(nsec)
      setCopied(true)
      toast.success('Private key copied')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copy failed — please reveal and write down the key')
    }
  }

  async function handleContinue() {
    setError(null)
    setLoading(true)
    try {
      const signer = createNsecSigner(hex)
      await login(signer, 'nsec')
      router.replace('/wallet/welcome')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create account'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col justify-between py-6">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            Create Account
          </h1>
          <p className="text-sm text-muted-foreground">
            We generated a private key for your new wallet. Save it somewhere
            safe — losing it means losing access to your account.
          </p>
        </div>

        <div className="space-y-3">
          <div className="relative rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex-1 break-all text-xs font-mono text-foreground',
                  !revealed && 'blur-sm select-none',
                )}
              >
                {nsec}
              </span>
              <button
                type="button"
                onClick={() => setRevealed(v => !v)}
                aria-label={revealed ? 'Hide private key' : 'Reveal private key'}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={handleCopy}
            className="w-full"
            disabled={loading}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : 'Copy private key'}
          </Button>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-border bg-card/50 p-4 text-sm text-foreground">
          <Checkbox
            checked={confirmed}
            onCheckedChange={v => setConfirmed(v === true)}
            disabled={loading}
            className="mt-0.5"
          />
          <span className="leading-snug">
            I&apos;ve saved my private key. I understand that if I lose it,
            I&apos;ll lose access to my account.
          </span>
        </label>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="space-y-3">
        <Button
          type="button"
          onClick={handleContinue}
          disabled={!confirmed || loading}
          className="w-full h-12"
        >
          {loading ? (
            <>
              <Spinner size={16} />
              Creating account...
            </>
          ) : (
            'Continue'
          )}
        </Button>
      </div>
    </div>
  )
}
