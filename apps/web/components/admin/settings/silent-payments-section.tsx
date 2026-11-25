'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { SettingSwitch } from '@/components/admin/settings/auto-save-controls'
import {
  DNS_INTEGRATION_IDS,
  INTEGRATIONS,
  SP_ENABLED_KEY,
  SP_PROVIDER_KEY,
  availableFlag
} from '@/lib/integrations/catalog'
import type { SettingsData } from '@/lib/client/hooks/use-settings'

interface Props {
  settings: SettingsData | null | undefined
  saveSetting: (patch: Record<string, string>) => Promise<void>
}

/**
 * BIP-353 silent payments: pick which DNS integration publishes the
 * `<user>.user._bitcoin-payment.<domain>` TXT records, and switch the
 * feature on. Credentials live on the Integrations page.
 */
export function SilentPaymentsSection({ settings, saveSetting }: Props) {
  // The parent keys this section on the stored values, so state re-seeds.
  const flags = (settings ?? {}) as Record<string, string | undefined>
  const [enabled, setEnabled] = useState(flags[SP_ENABLED_KEY] === 'true')
  const [provider, setProvider] = useState(flags[SP_PROVIDER_KEY] ?? '')

  const available = (id: string) =>
    flags[availableFlag(id as (typeof DNS_INTEGRATION_IDS)[number])] === 'true'

  async function changeProvider(next: string) {
    const prev = provider
    setProvider(next)
    try {
      await saveSetting({ [SP_PROVIDER_KEY]: next })
    } catch (err) {
      setProvider(prev)
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
      <div>
        <h3 className="text-sm font-semibold">Silent payments (BIP-353)</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Let users attach a silent payment address to their lightning
          address. It is published as a DNS TXT record so wallets can pay{' '}
          <code>₿user@domain</code> on-chain. The zone should be signed with
          DNSSEC.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="sp-provider">DNS provider</Label>
          <Select value={provider} onValueChange={changeProvider}>
            <SelectTrigger id="sp-provider" className="w-full max-w-sm">
              <SelectValue placeholder="Choose a DNS integration" />
            </SelectTrigger>
            <SelectContent>
              {DNS_INTEGRATION_IDS.map(id => (
                <SelectItem key={id} value={id} disabled={!available(id)}>
                  {INTEGRATIONS[id].name}
                  {!available(id) && ' (not set up)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Add credentials and enable a provider on the{' '}
            <Link href="/admin/integrations" className="underline">
              Integrations
            </Link>{' '}
            page.
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 max-w-sm">
          <Label htmlFor="sp-enabled">Enable silent payments</Label>
          <SettingSwitch
            id="sp-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!provider || !available(provider)}
            save={next =>
              saveSetting({ [SP_ENABLED_KEY]: next ? 'true' : 'false' })
            }
          />
        </div>
      </div>
    </div>
  )
}
