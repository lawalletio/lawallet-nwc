'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { generateSecretKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { createNsecSigner } from '@/lib/client/nostr-signer'
import { SecretKeyReveal } from '@/components/shared/secret-key-reveal'

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

  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleContinue() {
    setError(null)
    setLoading(true)
    try {
      const signer = createNsecSigner(hex)
      // Persist the nsec so reloads silently rebuild the signer.
      await login(signer, 'nsec', { secret: nsec })
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

        <SecretKeyReveal
          nsec={nsec}
          disabled={loading}
          confirmed={confirmed}
          onConfirmedChange={setConfirmed}
        />

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
