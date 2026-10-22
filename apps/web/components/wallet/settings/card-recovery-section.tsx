'use client'

import { useState } from 'react'
import { LifeBuoy } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'
import { useT } from '@/lib/client/i18n'

/**
 * Owner opt-out for card-based account recovery: when on, anyone holding one
 * of this account's cards can have card-manager print a RECOVER QR that moves
 * the whole account to a new key. Optimistic, rolled back on failure.
 */
export function CardRecoverySection() {
  const s = useT().settings.securityScreen.cardRecovery
  const { data } = useApi<{ cardRecoveryEnabled?: boolean }>('/api/users/me')
  const { mutate, loading } = useMutation<
    { enabled: boolean },
    { cardRecoveryEnabled: boolean }
  >(['/api/users/me'])
  const [override, setOverride] = useState<boolean | undefined>(undefined)

  const loaded = typeof data?.cardRecoveryEnabled === 'boolean'
  const enabled = override ?? data?.cardRecoveryEnabled ?? true

  async function handleToggle(next: boolean) {
    setOverride(next)
    try {
      await mutate('put', '/api/users/me/card-recovery', { enabled: next })
      toast.success(next ? s.enabled : s.disabled)
    } catch (err) {
      setOverride(undefined)
      toast.error(err instanceof Error ? err.message : s.failed)
    }
  }

  return (
    <>
      <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-card px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
            <LifeBuoy className="size-5" />
          </span>
          <span className="text-base font-medium text-foreground">
            {s.toggle}
          </span>
        </div>
        <Switch
          checked={enabled}
          disabled={!loaded || loading}
          aria-label={s.toggle}
          onCheckedChange={next => void handleToggle(next)}
        />
      </div>
      <p className="px-1 text-xs text-muted-foreground">{s.hint}</p>
    </>
  )
}
