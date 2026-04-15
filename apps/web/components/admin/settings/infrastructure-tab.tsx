'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Minus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { useSettings, useUpdateSettings } from '@/lib/client/hooks/use-settings'
import { useSettingsForm } from '@/components/admin/settings/settings-form-context'

export function InfrastructureTab() {
  const { data: settings, loading: settingsLoading } = useSettings()
  const { updateSettings } = useUpdateSettings()

  const [domain, setDomain] = useState('')
  const [subdomain, setSubdomain] = useState('')

  const [relays, setRelays] = useState<string[]>([''])

  // Load settings into state
  useEffect(() => {
    if (!settings) return
    setDomain(settings.domain ?? '')
    setSubdomain(settings.subdomain ?? '')
  }, [settings])

  // Register save handler with the page-level Save Changes button
  const save = useCallback(async () => {
    await updateSettings({
      domain: domain.trim().toLowerCase(),
      subdomain: subdomain.trim().toLowerCase(),
    })
  }, [updateSettings, domain, subdomain])

  const { markChanged } = useSettingsForm('infrastructure', save)

  function addRelay() {
    setRelays((prev) => [...prev, ''])
  }

  function removeRelay(index: number) {
    setRelays((prev) => prev.filter((_, i) => i !== index))
  }

  function updateRelay(index: number, value: string) {
    setRelays((prev) => prev.map((r, i) => (i === index ? value : r)))
  }

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={24} />
      </div>
    )
  }

  const previewDomain = domain.trim().toLowerCase() || 'your-domain.com'

  return (
    <div className="flex flex-col gap-8 px-4 pt-10 pb-8 w-full max-w-[1024px] mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Domain</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the domain and optional subdomain for your instance.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <Label>Domain</Label>
            <InputGroup>
              <InputGroupText>https://</InputGroupText>
              <Input
                placeholder="example.com"
                value={domain}
                onChange={e => {
                  setDomain(e.target.value)
                  markChanged()
                }}
                className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </InputGroup>
            <p className="text-xs text-muted-foreground">
              The root domain where your instance is hosted.
            </p>
          </div>

          <div className="space-y-1">
            <Label>Subdomain</Label>
            <InputGroup>
              <Input
                placeholder="app"
                value={subdomain}
                onChange={e => {
                  setSubdomain(e.target.value)
                  markChanged()
                }}
                className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <InputGroupText>.{domain.trim().toLowerCase() || 'domain.com'}</InputGroupText>
            </InputGroup>
            <p className="text-xs text-muted-foreground">
              Optional. Leave empty to use the root domain.
            </p>
          </div>

          <div className="rounded-md bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Lightning addresses will resolve as{' '}
              <span className="font-mono text-foreground">username@{previewDomain}</span>
            </p>
          </div>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Nostr</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure Nostr relay connections.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {relays.map((relay, index) => (
            <div key={index} className="flex items-center gap-2">
              <InputGroup className="flex-1">
                <InputGroupText>wss://</InputGroupText>
                <Input
                  placeholder="relay.example.com"
                  value={relay}
                  onChange={(e) => updateRelay(index, e.target.value)}
                  className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </InputGroup>
              {relays.length > 1 && (
                <Button variant="outline" size="icon" onClick={() => removeRelay(index)}>
                  <Minus className="size-4" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-fit" onClick={addRelay}>
            <Plus className="size-4 mr-1" />
            Add Relay
          </Button>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Blossom Media Server</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the Blossom media server URL.
          </p>
        </div>
        <div>
          <div className="space-y-1">
            <Label>URL</Label>
            <InputGroup>
              <InputGroupText>https://</InputGroupText>
              <Input placeholder="blossom.example.com" className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
            </InputGroup>
          </div>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">SMTP / AWS SES</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure email service for notifications.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <Label>Host</Label>
            <InputGroup>
              <InputGroupText>https://</InputGroupText>
              <Input placeholder="smtp.example.com" className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
            </InputGroup>
          </div>
          <div className="space-y-1">
            <Label>Port</Label>
            <Input placeholder="587" />
          </div>
          <div className="space-y-1">
            <Label>Username</Label>
            <Input placeholder="user@example.com" />
          </div>
          <div className="space-y-1">
            <Label>Password</Label>
            <Input type="password" placeholder="••••••••" />
          </div>
        </div>
      </div>
    </div>
  )
}
