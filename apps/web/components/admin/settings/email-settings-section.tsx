'use client'

import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Mail, Send, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import {
  SettingSwitch,
  SettingTextInput
} from '@/components/admin/settings/auto-save-controls'
import { useMutation } from '@/lib/client/hooks/use-api'
import type { SettingsData } from '@/lib/client/hooks/use-settings'
import { cn } from '@/lib/utils'

type ProviderType = 'smtp' | 'ses' | 'resend'

interface FieldDef {
  key: string
  label: string
  placeholder: string
  /** Write-only: never prefilled, only saved when non-empty. */
  secret?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  isInvalid?: (v: string) => boolean
  hint?: string
}

const HOST_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$|^localhost$|^\d{1,3}(\.\d{1,3}){3}$/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const PROVIDERS: Record<
  ProviderType,
  {
    label: string
    description: string
    fields: FieldDef[]
    configured: (s: SettingsData) => boolean
  }
> = {
  smtp: {
    label: 'SMTP',
    description: 'Any SMTP server (Postmark, Mailgun, Gmail, Mailpit…).',
    fields: [
      {
        key: 'smtp_host',
        label: 'Host',
        placeholder: 'smtp.example.com',
        isInvalid: v => v.trim() !== '' && !HOST_PATTERN.test(v.trim()),
        hint: 'Hostname only — no protocol.'
      },
      {
        key: 'smtp_port',
        label: 'Port',
        placeholder: '587',
        inputMode: 'numeric',
        isInvalid: v => v.trim() !== '' && !/^\d{1,5}$/.test(v.trim())
      },
      {
        key: 'smtp_username',
        label: 'Username',
        placeholder: 'user@example.com'
      },
      {
        key: 'smtp_password',
        label: 'Password',
        placeholder: '••••••••',
        secret: true
      }
    ],
    configured: s => Boolean(s.smtp_host?.trim())
  },
  ses: {
    label: 'AWS SES',
    description: 'Amazon Simple Email Service (API v2, SigV4-signed).',
    fields: [
      {
        key: 'ses_region',
        label: 'Region',
        placeholder: 'us-east-1',
        isInvalid: v =>
          v.trim() !== '' && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(v.trim())
      },
      {
        key: 'ses_access_key_id',
        label: 'Access key ID',
        placeholder: 'AKIA…'
      },
      {
        key: 'ses_secret_access_key',
        label: 'Secret access key',
        placeholder: '••••••••',
        secret: true
      }
    ],
    configured: s =>
      Boolean(
        s.ses_region?.trim() &&
        s.ses_access_key_id?.trim() &&
        s.ses_secret_access_key_configured === 'true'
      )
  },
  resend: {
    label: 'Resend',
    description: 'resend.com transactional email API.',
    fields: [
      {
        key: 'resend_api_key',
        label: 'API key',
        placeholder: 're_…',
        secret: true
      }
    ],
    configured: s => s.resend_api_key_configured === 'true'
  }
}

const PROVIDER_ORDER: ProviderType[] = ['smtp', 'ses', 'resend']

function readValue(settings: SettingsData, key: string): string {
  const v = (settings as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

interface EmailSettingsSectionProps {
  settings: SettingsData | null | undefined
  saveSetting: (patch: Record<string, string>) => Promise<void>
}

export function EmailSettingsSection({
  settings,
  saveSetting
}: EmailSettingsSectionProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<ProviderType | null>(null)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState<ProviderType | null>(null)
  const [loginEnabled, setLoginEnabled] = useState(false)
  const { mutate } = useMutation<
    { provider: ProviderType; to: string },
    { ok: boolean; error?: string }
  >()

  // Hydrate once — re-running on every refetch would clobber active edits.
  const hydrated = useRef(false)
  useEffect(() => {
    if (hydrated.current || !settings) return
    hydrated.current = true
    const next: Record<string, string> = {
      email_from_address: settings.email_from_address ?? '',
      email_from_name: settings.email_from_name ?? ''
    }
    for (const p of PROVIDER_ORDER) {
      for (const f of PROVIDERS[p].fields) {
        next[f.key] = f.secret ? '' : readValue(settings, f.key)
      }
    }
    setValues(next)
    setLoginEnabled(settings.email_login_enabled === 'true')
    setOpen(
      (settings.email_default_provider as ProviderType | undefined) ?? 'smtp'
    )
  }, [settings])

  if (!settings) return null

  const defaultProvider =
    (settings.email_default_provider as ProviderType | undefined) ?? null
  const vaultReady = settings.key_vault_configured === 'true'
  const emailReady = settings.email_configured === 'true'
  const setValue = (key: string) => (v: string) =>
    setValues(prev => ({ ...prev, [key]: v }))

  async function sendTest(provider: ProviderType) {
    if (!EMAIL_PATTERN.test(testTo.trim())) {
      toast.error('Enter a recipient address to send the test to')
      return
    }
    setTesting(provider)
    try {
      const res = await mutate('post', '/api/settings/email-test', {
        provider,
        to: testTo.trim()
      })
      if (res.ok)
        toast.success(`Test email sent via ${PROVIDERS[provider].label}`)
      else toast.error(res.error ?? 'Failed to send test email')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to send test email'
      )
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
      <div>
        <h3 className="text-sm font-semibold">Email</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Configure one or more providers and pick the default. Used for
          magic-link login and other notifications.
        </p>
      </div>
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>From address</Label>
            <SettingTextInput
              type="email"
              placeholder="hello@example.com"
              value={values.email_from_address ?? ''}
              onValueChange={setValue('email_from_address')}
              isInvalidValue={v =>
                v.trim() !== '' && !EMAIL_PATTERN.test(v.trim())
              }
              invalid={
                (values.email_from_address ?? '').trim() !== '' &&
                !EMAIL_PATTERN.test((values.email_from_address ?? '').trim())
              }
              save={v =>
                saveSetting({ email_from_address: v.trim().toLowerCase() })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>From name</Label>
            <SettingTextInput
              placeholder={settings.community_name || 'LaWallet'}
              value={values.email_from_name ?? ''}
              onValueChange={setValue('email_from_name')}
              save={v => saveSetting({ email_from_name: v.trim() })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {PROVIDER_ORDER.map(type => {
            const p = PROVIDERS[type]
            const configured = p.configured(settings)
            const isDefault = defaultProvider === type
            return (
              <Collapsible
                key={type}
                open={open === type}
                onOpenChange={o => setOpen(o ? type : null)}
                className={cn(
                  'rounded-xl border transition-colors',
                  isDefault && 'border-primary/60 bg-primary/5'
                )}
              >
                <div className="flex items-center gap-3 p-4">
                  <CollapsibleTrigger className="flex flex-1 items-center gap-3 text-left">
                    <Mail className="size-4 text-muted-foreground" />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{p.label}</span>
                        <Badge variant={configured ? 'default' : 'secondary'}>
                          {configured ? 'Configured' : 'Not configured'}
                        </Badge>
                        {isDefault && (
                          <Badge variant="outline" className="gap-1">
                            <Star className="size-3 fill-current" /> Default
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {p.description}
                      </p>
                    </div>
                    <ChevronDown
                      className={cn(
                        'size-4 text-muted-foreground transition-transform',
                        open === type && 'rotate-180'
                      )}
                    />
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in">
                  <div className="flex flex-col gap-4 border-t p-4">
                    {p.fields.map(f => {
                      const value = values[f.key] ?? ''
                      const invalid = f.isInvalid?.(value) ?? false
                      const secretSet =
                        f.secret &&
                        readValue(settings, `${f.key}_configured`) === 'true'
                      return (
                        <div key={f.key} className="space-y-1">
                          <Label>{f.label}</Label>
                          <SettingTextInput
                            type={f.secret ? 'password' : 'text'}
                            autoComplete={f.secret ? 'new-password' : 'off'}
                            inputMode={f.inputMode}
                            placeholder={
                              secretSet
                                ? '•••••••• (configured)'
                                : f.placeholder
                            }
                            value={value}
                            onValueChange={setValue(f.key)}
                            invalid={invalid}
                            isInvalidValue={v =>
                              (f.isInvalid?.(v) ?? false) ||
                              // Secrets are write-only: clearing the input
                              // must not wipe the stored value.
                              (f.secret === true && v === '')
                            }
                            save={v =>
                              saveSetting({
                                [f.key]: f.secret ? v : v.trim()
                              })
                            }
                          />
                          {invalid && f.hint && (
                            <p className="text-xs text-destructive">{f.hint}</p>
                          )}
                        </div>
                      )
                    })}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant={isDefault ? 'secondary' : 'default'}
                        disabled={isDefault}
                        onClick={() =>
                          saveSetting({ email_default_provider: type }).catch(
                            err =>
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : 'Failed to save'
                              )
                          )
                        }
                      >
                        <Star className="size-4 mr-1" />
                        {isDefault ? 'Default provider' : 'Make default'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!configured || testing !== null}
                        onClick={() => sendTest(type)}
                      >
                        <Send className="size-4 mr-1" />
                        {testing === type ? 'Sending…' : 'Send test email'}
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>

        <div className="space-y-1">
          <Label>Send test emails to</Label>
          <Input
            type="email"
            placeholder="you@example.com"
            value={testTo}
            onChange={e => setTestTo(e.target.value)}
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
          <div>
            <p className="text-sm font-medium">Email login</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Let anyone sign in or sign up with a magic link. New users get a
              server-custodied Nostr key.
            </p>
            {!emailReady && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Configure a default provider and a &ldquo;from&rdquo; address
                first.
              </p>
            )}
            {!vaultReady && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Requires KEY_VAULT_SECRET (or JWT_SECRET) to be set.
              </p>
            )}
          </div>
          <SettingSwitch
            checked={loginEnabled}
            disabled={!loginEnabled && (!emailReady || !vaultReady)}
            onCheckedChange={setLoginEnabled}
            save={checked =>
              saveSetting({ email_login_enabled: checked ? 'true' : 'false' })
            }
          />
        </div>
      </div>
    </div>
  )
}
