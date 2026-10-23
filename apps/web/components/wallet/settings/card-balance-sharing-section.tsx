'use client'

import { useState } from 'react'
import { Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'
import { useT } from '@/lib/client/i18n'

/**
 * Owner toggle for reporting the wallet balance to the point of sale after a
 * card tap (LNURL-withdraw callback). On by default. Optimistic, rolled back
 * on failure.
 */
export function CardBalanceSharingSection() {
  const s = useT().settings.cardsScreen.balanceSharing
  const { data } = useApi<{ cardBalanceShared?: boolean }>('/api/users/me')
  const { mutate, loading } = useMutation<
    { enabled: boolean },
    { cardBalanceShared: boolean }
  >(['/api/users/me'])
  const [override, setOverride] = useState<boolean | undefined>(undefined)

  const loaded = typeof data?.cardBalanceShared === 'boolean'
  const enabled = override ?? data?.cardBalanceShared ?? true

  async function handleToggle(next: boolean) {
    setOverride(next)
    try {
      await mutate('put', '/api/users/me/card-balance-sharing', {
        enabled: next
      })
      toast.success(next ? s.enabled : s.disabled)
    } catch (err) {
      setOverride(undefined)
      toast.error(err instanceof Error ? err.message : s.failed)
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-card px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
            <Wallet className="size-5" />
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
    </section>
  )
}
