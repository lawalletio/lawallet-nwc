'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/**
 * Dev-only "Add test voucher" button.
 *
 * Mints a random coupon from the in-app dev coupon service and drops it in the
 * caller's stash. The result is a working voucher, not a decorative row:
 * Refresh polls a real claim endpoint and Send performs a real nonce swap, so
 * the whole flow is exercisable without standing up an external service.
 *
 * Render it behind `process.env.NODE_ENV === 'development'` — Next inlines
 * that to `false` in a production build, so the button is tree-shaken out —
 * and the endpoint 404s without `ENABLE_DEV_ROUTES=true`. Double-gated, the
 * same arrangement as `dev-remove-all-cards.tsx`.
 */
export function DevCreateVoucher({ onCreated }: { onCreated?: () => void }) {
  const [loading, setLoading] = useState(false)

  async function create() {
    setLoading(true)
    try {
      const token =
        typeof window === 'undefined'
          ? null
          : window.localStorage.getItem('lawallet-jwt')
      const res = await fetch('/api/dev/vouchers', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : undefined
      })
      if (!res.ok) throw new Error(`Failed to create voucher (${res.status})`)
      const data = await res.json()
      toast.success(`Added “${data.name}”`)
      onCreated?.()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create voucher'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" onClick={create} disabled={loading}>
      {loading ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <Sparkles data-icon="inline-start" />
      )}
      Add test voucher
    </Button>
  )
}
