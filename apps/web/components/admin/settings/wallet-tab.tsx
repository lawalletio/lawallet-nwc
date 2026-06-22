'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { useSettings } from '@/lib/client/hooks/use-settings'
import {
  useSettingSaver,
  SettingSwitch,
  SettingTextInput,
  SettingInputGroup,
} from '@/components/admin/settings/auto-save-controls'
import { DEFAULT_LNCURL_SERVER } from '@/lib/lncurl'

export function WalletTab() {
  const { data: settings, loading: settingsLoading } = useSettings()
  const saveSetting = useSettingSaver()

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
  const [paidToggleSaving, setPaidToggleSaving] = useState(false)

  // Restore local form state from the currently stored settings. With per-field
  // auto-save there's no Cancel/reset path, so we hydrate exactly once — re-running
  // on every settings refetch would clobber a field the user is actively editing.
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

  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current || !settings) return
    hydratedRef.current = true
    loadFromSettings()
  }, [settings, loadFromSettings])

  // Paid registration is interdependent: the API rejects `enabled` without a
  // reachable payment address (and re-probes when the address/price changes),
  // so the toggle + address + price persist together as one unit.
  const persistPaid = useCallback(
    async (patch: { enabled?: boolean; address?: string; price?: string }) => {
      const enabled = patch.enabled ?? registrationEnabled
      const address = (patch.address ?? registrationLnAddress).trim()
      const price = (patch.price ?? registrationPrice) || '21'
      // Can't enable paid registration without a payment address — keep the DB
      // consistent (disabled) until one is provided; the inline hint explains it.
      if (enabled && !address) {
        await saveSetting({ registration_ln_enabled: 'false' })
        return
      }
      await saveSetting({
        registration_ln_enabled: enabled ? 'true' : 'false',
        registration_ln_address: address,
        registration_price: price,
      })
    },
    [saveSetting, registrationEnabled, registrationLnAddress, registrationPrice]
  )

  async function handlePaidToggle(next: boolean) {
    const prev = registrationEnabled
    setRegistrationEnabled(next)
    // Turning on with no address yet just reveals the fields — persistence
    // happens once a valid address is entered. Turning off persists at once.
    if (next && !registrationLnAddress.trim()) return
    setPaidToggleSaving(true)
    try {
      await persistPaid({ enabled: next })
    } catch (err) {
      setRegistrationEnabled(prev)
      toast.error(err instanceof Error ? err.message : 'Failed to update setting')
    } finally {
      setPaidToggleSaving(false)
    }
  }

  const paidNeedsAddress = registrationEnabled && !registrationLnAddress.trim()

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
            <SettingSwitch
              checked={maintenanceEnabled}
              onCheckedChange={setMaintenanceEnabled}
              save={next => saveSetting({ maintenance_enabled: next ? 'true' : 'false' })}
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
            <SettingSwitch
              checked={registrationUserEnabled}
              onCheckedChange={setRegistrationUserEnabled}
              save={next =>
                saveSetting({ registration_user_enabled: next ? 'true' : 'false' })
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Paid Registration</p>
              <p className="text-sm text-muted-foreground">
                Charge users a fee to register a Lightning Address.
              </p>
            </div>
            <span className="inline-flex items-center gap-2">
              {paidToggleSaving && (
                <Spinner size={16} className="text-muted-foreground" />
              )}
              <Switch
                checked={registrationEnabled}
                disabled={paidToggleSaving}
                onCheckedChange={handlePaidToggle}
              />
            </span>
          </div>
          {registrationEnabled && (
            <>
              <div className="space-y-1">
                <Label>Payment Address</Label>
                <SettingTextInput
                  type="text"
                  placeholder="admin@getalby.com"
                  value={registrationLnAddress}
                  onValueChange={setRegistrationLnAddress}
                  save={addr => persistPaid({ address: addr })}
                />
                <p className={paidNeedsAddress ? 'text-xs text-amber-500' : 'text-xs text-muted-foreground'}>
                  {paidNeedsAddress
                    ? 'Enter a payment address to activate paid registration.'
                    : 'Lightning address where registration payments will be sent.'}
                </p>
              </div>
              <div className="space-y-1">
                <Label>Price</Label>
                <SettingInputGroup
                  type="number"
                  placeholder="21"
                  min={1}
                  value={registrationPrice}
                  onValueChange={setRegistrationPrice}
                  save={price => persistPaid({ price })}
                  suffix="sats"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Admins & operators bypass payment</p>
                  <p className="text-sm text-muted-foreground">
                    When an admin or operator creates an address, skip the registration fee.
                  </p>
                </div>
                <SettingSwitch
                  checked={registrationAdminBypass}
                  onCheckedChange={setRegistrationAdminBypass}
                  save={next =>
                    saveSetting({ registration_admin_bypass: next ? 'true' : 'false' })
                  }
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
            <SettingSwitch
              checked={lncurlEnabled}
              onCheckedChange={setLncurlEnabled}
              save={async next => {
                if (next) {
                  await saveSetting({ lncurl_enabled: 'true' })
                } else {
                  // Disabling LNCurl also clears its dependent auto-* flags so
                  // they can't fire while the feature is off.
                  setLncurlAutoCreate(false)
                  setLncurlAutoRecreate(false)
                  await saveSetting({
                    lncurl_enabled: 'false',
                    lncurl_auto_create: 'false',
                    lncurl_auto_recreate: 'false',
                  })
                }
              }}
            />
          </div>

          {lncurlEnabled && (
            <>
              <div className="space-y-1">
                <Label>Server URL</Label>
                <SettingTextInput
                  type="url"
                  placeholder={DEFAULT_LNCURL_SERVER}
                  value={lncurlServerUrl}
                  onValueChange={setLncurlServerUrl}
                  save={url =>
                    saveSetting({ lncurl_server_url: url.trim() || DEFAULT_LNCURL_SERVER })
                  }
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
                <SettingSwitch
                  checked={lncurlAutoCreate}
                  onCheckedChange={setLncurlAutoCreate}
                  save={next =>
                    saveSetting({ lncurl_auto_create: next ? 'true' : 'false' })
                  }
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
                <SettingSwitch
                  checked={lncurlAutoRecreate}
                  onCheckedChange={setLncurlAutoRecreate}
                  save={next =>
                    saveSetting({ lncurl_auto_recreate: next ? 'true' : 'false' })
                  }
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
