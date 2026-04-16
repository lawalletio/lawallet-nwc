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
import { cn } from '@/lib/utils'

// Settings values are stored as strings. Array-typed settings (relays, blossom_servers)
// are JSON-stringified. Default to a single empty input when absent or malformed.
function parseStringArray(raw: string | undefined): string[] {
  if (!raw) return ['']
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) {
      return parsed.length > 0 ? parsed : ['']
    }
  } catch {
    // fall through to default
  }
  return ['']
}

// ── Validators ──────────────────────────────────────────────────────────────
// Hostname only — no protocol, no path. Must include at least one dot and a
// 2+ character TLD. Labels are 1–63 chars, letters/digits/hyphens, no leading
// or trailing hyphen.
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

function isValidDomain(value: string): boolean {
  return DOMAIN_PATTERN.test(value.trim())
}

function isValidUrlWithProtocol(value: string, allowed: readonly string[]): boolean {
  try {
    const url = new URL(value.trim())
    return allowed.includes(url.protocol) && url.hostname.length > 0
  } catch {
    return false
  }
}

const HTTP_PROTOCOLS = ['http:', 'https:'] as const
const WS_PROTOCOLS = ['ws:', 'wss:'] as const

// Classes to apply an error state to an Input or InputGroup border.
// tailwind-merge lets the later `border-destructive` win over `border-input`/`border-border`.
const INVALID_CLASSES = 'border-destructive focus-visible:ring-destructive focus-within:ring-destructive'

export function InfrastructureTab() {
  const { data: settings, loading: settingsLoading } = useSettings()
  const { updateSettings } = useUpdateSettings()

  const [domain, setDomain] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [currentOrigin, setCurrentOrigin] = useState('')

  const [relays, setRelays] = useState<string[]>([''])
  const [blossomServers, setBlossomServers] = useState<string[]>([''])
  const [smtpHost, setSmtpHost] = useState('')

  // Capture the current browser origin once on mount for the endpoint placeholder
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCurrentOrigin(window.location.origin)
    }
  }, [])

  // Restore all local form state from the currently stored settings. Called on
  // initial load and whenever the page-level Cancel button is clicked.
  const loadFromSettings = useCallback(() => {
    if (!settings) return
    setDomain(settings.domain ?? '')
    setSubdomain(settings.subdomain ?? settings.endpoint ?? '')
    setRelays(parseStringArray(settings.relays))
    setBlossomServers(parseStringArray(settings.blossom_servers))
    setSmtpHost(settings.smtp_host ?? '')
  }, [settings])

  useEffect(() => {
    loadFromSettings()
  }, [loadFromSettings])

  // Register save handler with the page-level Save Changes button.
  // Endpoint: trim whitespace and any trailing slashes before persisting.
  // Relays and blossom servers are stored as JSON-stringified arrays of non-empty trimmed entries.
  const save = useCallback(async () => {
    await updateSettings({
      domain: domain.trim().toLowerCase(),
      endpoint: subdomain.trim().replace(/\/+$/, '').toLowerCase(),
      relays: JSON.stringify(relays.map(r => r.trim()).filter(Boolean)),
      blossom_servers: JSON.stringify(blossomServers.map(s => s.trim()).filter(Boolean)),
      smtp_host: smtpHost.trim().toLowerCase(),
    })
  }, [updateSettings, domain, subdomain, relays, blossomServers, smtpHost])

  const { markChanged, setInvalid } = useSettingsForm('infrastructure', save, loadFromSettings)

  // Per-field validity — empty inputs are treated as valid (they're simply
  // not included in the save payload). Only non-empty, malformed values flag.
  const domainInvalid = domain.trim() !== '' && !isValidDomain(domain)
  const endpointInvalid =
    subdomain.trim() !== '' && !isValidUrlWithProtocol(subdomain, HTTP_PROTOCOLS)
  const relayInvalid = relays.map(
    r => r.trim() !== '' && !isValidUrlWithProtocol(r, WS_PROTOCOLS)
  )
  const blossomInvalid = blossomServers.map(
    s => s.trim() !== '' && !isValidUrlWithProtocol(s, HTTP_PROTOCOLS)
  )
  const smtpHostInvalid = smtpHost.trim() !== '' && !isValidDomain(smtpHost)

  // Collapse all per-field flags into a single primitive so the effect only
  // fires when the aggregate state actually changes (relay/blossom arrays
  // would otherwise be new references every render).
  const anyInvalid =
    domainInvalid ||
    endpointInvalid ||
    relayInvalid.some(Boolean) ||
    blossomInvalid.some(Boolean) ||
    smtpHostInvalid

  useEffect(() => {
    setInvalid(anyInvalid)
  }, [anyInvalid, setInvalid])

  function addRelay() {
    setRelays((prev) => [...prev, ''])
    markChanged()
  }

  function removeRelay(index: number) {
    setRelays((prev) => prev.filter((_, i) => i !== index))
    markChanged()
  }

  function updateRelay(index: number, value: string) {
    setRelays((prev) => prev.map((r, i) => (i === index ? value : r)))
    markChanged()
  }

  function addBlossom() {
    setBlossomServers((prev) => [...prev, ''])
    markChanged()
  }

  function removeBlossom(index: number) {
    setBlossomServers((prev) => prev.filter((_, i) => i !== index))
    markChanged()
  }

  function updateBlossom(index: number, value: string) {
    setBlossomServers((prev) => prev.map((b, i) => (i === index ? value : b)))
    markChanged()
  }

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={24} />
      </div>
    )
  }

  // Lightning addresses resolve as `username@<domain>` — the preview shows
  // the raw domain only (no protocol, no endpoint path).
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
            <InputGroup className={cn(domainInvalid && INVALID_CLASSES)}>
              <InputGroupText>https://</InputGroupText>
              <Input
                placeholder="example.com"
                value={domain}
                onChange={e => {
                  setDomain(e.target.value)
                  markChanged()
                }}
                aria-invalid={domainInvalid || undefined}
                className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </InputGroup>
            {domainInvalid ? (
              <p className="text-xs text-destructive">
                Enter a valid domain (e.g. example.com) — no protocol.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                The official domain for your users.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label>Endpoint</Label>
            <Input
              placeholder={currentOrigin || 'https://app.domain.com'}
              value={subdomain}
              onChange={e => {
                setSubdomain(e.target.value)
                markChanged()
              }}
              aria-invalid={endpointInvalid || undefined}
              className={cn(endpointInvalid && INVALID_CLASSES)}
            />
            {endpointInvalid ? (
              <p className="text-xs text-destructive">
                Enter a full URL with http:// or https://.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Full public URL where this instance is running.
              </p>
            )}
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
              <Input
                className={cn('flex-1', relayInvalid[index] && INVALID_CLASSES)}
                placeholder="wss://relay.example.com"
                value={relay}
                onChange={(e) => updateRelay(index, e.target.value)}
                aria-invalid={relayInvalid[index] || undefined}
              />
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
        <div className="flex flex-col gap-3">
          {blossomServers.map((server, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                className={cn('flex-1', blossomInvalid[index] && INVALID_CLASSES)}
                placeholder="https://blossom.example.com"
                value={server}
                onChange={(e) => updateBlossom(index, e.target.value)}
                aria-invalid={blossomInvalid[index] || undefined}
              />
              {blossomServers.length > 1 && (
                <Button variant="outline" size="icon" onClick={() => removeBlossom(index)}>
                  <Minus className="size-4" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-fit" onClick={addBlossom}>
            <Plus className="size-4 mr-1" />
            Add Server
          </Button>
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
            <InputGroup className={cn(smtpHostInvalid && INVALID_CLASSES)}>
              <InputGroupText>https://</InputGroupText>
              <Input
                placeholder="smtp.example.com"
                value={smtpHost}
                onChange={e => {
                  setSmtpHost(e.target.value)
                  markChanged()
                }}
                aria-invalid={smtpHostInvalid || undefined}
                className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </InputGroup>
            {smtpHostInvalid && (
              <p className="text-xs text-destructive">
                Enter a valid host (e.g. smtp.example.com) — no protocol.
              </p>
            )}
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
