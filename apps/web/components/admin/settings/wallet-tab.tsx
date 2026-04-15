'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { useSettings, useUpdateSettings } from '@/lib/client/hooks/use-settings'
import { useSettingsForm } from '@/components/admin/settings/settings-form-context'

export function WalletTab() {
  const { data: settings, loading: settingsLoading } = useSettings()
  const { updateSettings } = useUpdateSettings()

  const [registrationLnAddress, setRegistrationLnAddress] = useState('')
  const [registrationPrice, setRegistrationPrice] = useState('21')
  const [registrationEnabled, setRegistrationEnabled] = useState(false)

  // Load settings into state
  useEffect(() => {
    if (!settings) return
    setRegistrationLnAddress(settings.registration_ln_address ?? '')
    setRegistrationPrice(settings.registration_price ?? '21')
    setRegistrationEnabled(settings.registration_ln_enabled === 'true')
  }, [settings])

  // Register save handler with the page-level Save Changes button
  const save = useCallback(async () => {
    await updateSettings({
      registration_ln_address: registrationLnAddress.trim(),
      registration_price: registrationPrice || '21',
      registration_ln_enabled: registrationEnabled ? 'true' : 'false',
    })
  }, [updateSettings, registrationLnAddress, registrationPrice, registrationEnabled])

  const { markChanged } = useSettingsForm('wallet', save)

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={24} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 px-4 pt-10 pb-8 w-full max-w-[1024px] mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Digital Wallet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the digital wallet for your instance.
          </p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enabled Mode</p>
              <p className="text-sm text-muted-foreground">
                Activate or deactivate the digital wallet.
              </p>
            </div>
            <Switch />
          </div>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Maintenance</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Put services into maintenance mode.
          </p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">General Maintenance</p>
              <p className="text-sm text-muted-foreground">
                Enable maintenance mode for all services.
              </p>
            </div>
            <Switch />
          </div>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-6">
        <Label className="text-sm font-semibold">Control management</Label>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Disable Transfers</p>
              <p className="text-sm text-muted-foreground">
                Prevent users from sending and receiving transfers.
              </p>
            </div>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Disable Registers</p>
              <p className="text-sm text-muted-foreground">
                Prevent new user registrations.
              </p>
            </div>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Disable Address</p>
              <p className="text-sm text-muted-foreground">
                Disable Lightning Address functionality.
              </p>
            </div>
            <Switch />
          </div>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Lightning Address</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure Lightning Address registration and pricing.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enabled Mode</p>
              <p className="text-sm text-muted-foreground">
                Enable paid registration for Lightning Addresses.
              </p>
            </div>
            <Switch
              checked={registrationEnabled}
              onCheckedChange={v => { setRegistrationEnabled(v); markChanged() }}
            />
          </div>
          <div className="space-y-1">
            <Label>Payment Address</Label>
            <Input
              type="text"
              placeholder="admin@getalby.com"
              value={registrationLnAddress}
              onChange={e => { setRegistrationLnAddress(e.target.value); markChanged() }}
            />
            <p className="text-xs text-muted-foreground">
              Lightning address where registration payments will be sent.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Price</Label>
            <InputGroup>
              <Input
                type="number"
                placeholder="21"
                min={1}
                value={registrationPrice}
                onChange={e => { setRegistrationPrice(e.target.value); markChanged() }}
                className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <InputGroupText>sats</InputGroupText>
            </InputGroup>
          </div>
        </div>
      </div>
    </div>
  )
}
