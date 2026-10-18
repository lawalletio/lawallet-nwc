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
import { useT } from '@/lib/client/i18n'

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
  const t = useT()
  const tc = t.onboarding.createAccount

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
    try {
      const signer = createNsecSigner(hex)
      // Persist the nsec so reloads silently rebuild the signer.
      await login(signer, 'nsec', { secret: nsec })
      router.replace('/wallet/welcome')
    } catch (err) {
      const message = err instanceof Error ? err.message : tc.failed
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
          <h1 className="text-2xl font-semibold text-foreground">{tc.title}</h1>
          <p className="text-sm text-muted-foreground">{tc.subtitle}</p>
        </div>

        <SecretKeyReveal
          nsec={nsec}
          disabled={loading}
          confirmed={confirmed}
          onConfirmedChange={setConfirmed}
          confirmLabel={tc.confirmLabel}
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
              {tc.creating}
            </>
          ) : (
            t.common.continue
          )}
        </Button>
      </div>
    </div>
  )
}
