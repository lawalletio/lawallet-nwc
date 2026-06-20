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
import { DEFAULT_LNCURL_SERVER } from '@/lib/lncurl'

export function WalletTab() {
  const { data: settings, loading: settingsLoading } = useSettings()
  const { updateSettings } = useUpdateSettings()

  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false)
  const [registrationLnAddress, setRegistrationLnAddress] = useState('')
  const [registrationPrice, setRegistrationPrice] = useState('21')
  const [registrationUserEnabled, setRegistrationUserEnabled] = useState(true)
  const [registrationEnabled, setRegistrationEnabled] = useState(false)
  const [registrationAdminBypass, setRegistrationAdminBypass] = useState(true)
  const [lncurlEnabled, setLncurlEnabled] = useState(false)
  const [lncurlServerUrl, setLncurlServerUrl] = useState(DEFAULT_LNCURL_SERVER)
  const [lncurlAutoCreate, setLncurlAutoCreate] = useState(false)
  const [lncurlAutoRecreate, setLncurlAutoRecreate] = useState(false)

  // Restore all local form state from the currently stored settings. Called on
  // initial load and whenever the page-level Cancel button is clicked.
  const loadFromSettings = useCallback(() => {
    if (!settings) return
    setMaintenanceEnabled(settings.maintenance_enabled === 'true')
    setRegistrationLnAddress(settings.registration_ln_address ?? '')
    setRegistrationPrice(settings.registration_price ?? '21')
    setRegistrationUserEnabled(
      (settings.registration_user_enabled ?? 'true') === 'true'
    )
    setRegistrationEnabled(settings.registration_ln_enabled === 'true')
    setRegistrationAdminBypass(
      (settings.registration_admin_bypass ?? 'true') === 'true'
    )
    setLncurlEnabled(settings.lncurl_enabled === 'true')
    setLncurlServerUrl(settings.lncurl_server_url ?? DEFAULT_LNCURL_SERVER)
    setLncurlAutoCreate(settings.lncurl_auto_create === 'true')
    setLncurlAutoRecreate(settings.lncurl_auto_recreate === 'true')
  }, [settings])

  useEffect(() => {
    loadFromSettings()
  }, [loadFromSettings])

  // Register save handler with the page-level Save Changes button
  const save = useCallback(async () => {
    await updateSettings({
      maintenance_enabled: maintenanceEnabled ? 'true' : 'false',
      registration_ln_address: registrationLnAddress.trim(),
      registration_price: registrationPrice || '21',
      registration_user_enabled: registrationUserEnabled ? 'true' : 'false',
      registration_ln_enabled: registrationEnabled ? 'true' : 'false',
      registration_admin_bypass: registrationAdminBypass ? 'true' : 'false',
      lncurl_enabled: lncurlEnabled ? 'true' : 'false',
      lncurl_server_url: lncurlServerUrl.trim() || DEFAULT_LNCURL_SERVER,
      lncurl_auto_create: lncurlEnabled && lncurlAutoCreate ? 'true' : 'false',
      lncurl_auto_recreate: lncurlEnabled && lncurlAutoRecreate ? 'true' : 'false',
    })
  }, [
    updateSettings,
    maintenanceEnabled,
    registrationLnAddress,
    registrationPrice,
    registrationUserEnabled,
    registrationEnabled,
    registrationAdminBypass,
    lncurlEnabled,
    lncurlServerUrl,
    lncurlAutoCreate,
    lncurlAutoRecreate,
  ])

  const { markChanged } = useSettingsForm('wallet', save, loadFromSettings)

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
            <Switch
              checked={maintenanceEnabled}
              onCheckedChange={v => { setMaintenanceEnabled(v); markChanged() }}
            />
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
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">User Registration</p>
              <p className="text-sm text-muted-foreground">
                Allow non-admin users to create Lightning Addresses. When off,
                only admins can create them.
              </p>
            </div>
            <Switch
              checked={registrationUserEnabled}
              onCheckedChange={v => { setRegistrationUserEnabled(v); markChanged() }}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Paid Registration</p>
              <p className="text-sm text-muted-foreground">
                Charge users a fee to register a Lightning Address.
              </p>
            </div>
            <Switch
              checked={registrationEnabled}
              onCheckedChange={v => { setRegistrationEnabled(v); markChanged() }}
            />
          </div>
          {registrationEnabled && (
            <>
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
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Admins & operators bypass payment</p>
                  <p className="text-sm text-muted-foreground">
                    When an admin or operator creates an address, skip the registration fee.
                  </p>
                </div>
                <Switch
                  checked={registrationAdminBypass}
                  onCheckedChange={v => { setRegistrationAdminBypass(v); markChanged() }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">LNCurl Wallets</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Let users spin up a disposable custodial wallet instead of pasting an
            NWC connection string.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Enable LNCurl</p>
              <p className="text-sm text-muted-foreground">
                Show a “Create an LNCurl wallet” option when connecting a wallet.
              </p>
            </div>
            <Switch
              checked={lncurlEnabled}
              onCheckedChange={v => { setLncurlEnabled(v); markChanged() }}
            />
          </div>

          {lncurlEnabled && (
            <>
              <div className="space-y-1">
                <Label>Server URL</Label>
                <Input
                  type="url"
                  placeholder={DEFAULT_LNCURL_SERVER}
                  value={lncurlServerUrl}
                  onChange={e => { setLncurlServerUrl(e.target.value); markChanged() }}
                />
                <p className="text-xs text-muted-foreground">
                  LNCurl provider that mints the wallets. Defaults to{' '}
                  <code>{DEFAULT_LNCURL_SERVER}</code>.
                </p>
              </div>

              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-xs text-yellow-700 dark:text-yellow-400">
                LNCurl wallets cost <strong>1 sat per hour</strong> to stay alive —
                the <strong>first hour is free</strong>. If the balance runs out
                and hits <strong>0 sats the wallet is permanently destroyed</strong>.
                They&apos;re for quick, low-value use — not for storing funds.
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Autocreate wallet on new account</p>
                  <p className="text-sm text-muted-foreground">
                    Give every new account a default LNCurl wallet at signup.
                  </p>
                </div>
                <Switch
                  checked={lncurlAutoCreate}
                  onCheckedChange={v => { setLncurlAutoCreate(v); markChanged() }}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Recreate when a wallet dies</p>
                  <p className="text-sm text-muted-foreground">
                    If an LNCurl wallet is destroyed, mint a replacement on the
                    next incoming payment so the Lightning Address keeps
                    receiving.
                  </p>
                </div>
                <Switch
                  checked={lncurlAutoRecreate}
                  onCheckedChange={v => { setLncurlAutoRecreate(v); markChanged() }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
