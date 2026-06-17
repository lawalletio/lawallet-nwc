'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { useTheme } from '@/lib/client/theme-context'
import { cn } from '@/lib/utils'
import { useSettings, useUpdateSettings } from '@/lib/client/hooks/use-settings'
import { useSettingsForm } from '@/components/admin/settings/settings-form-context'
import { useBlossomUpload } from '@/lib/client/hooks/use-blossom-upload'
import {
  DEFAULT_ISOTYPO_SRC,
  DEFAULT_LOGOTYPE_SRC,
} from '@/lib/client/hooks/use-brand'

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
const ACCEPT_ATTR = '.jpg,.jpeg,.png,.webp,.svg'
const ACCEPTED_HINT = 'JPG, PNG, WebP or SVG'

function validateImageFile(file: File) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    toast.error('Only JPG, PNG, WebP or SVG files are accepted.')
    return false
  }
  if (file.size > MAX_FILE_SIZE) {
    toast.error('File must be smaller than 2MB.')
    return false
  }
  return true
}

export function BrandingTab() {
  const { activePreset, setTheme, presets, rounding, setRounding, roundingOptions } = useTheme()
  const { data: settings } = useSettings()
  const { updateSettings } = useUpdateSettings()
  const [logotypePreview, setLogotypePreview] = useState<string | null>(null)
  const [isotypoPreview, setIsotypoPreview] = useState<string | null>(null)
  const [communityName, setCommunityName] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [telegram, setTelegram] = useState('')
  const [discord, setDiscord] = useState('')
  const [twitter, setTwitter] = useState('')
  const [website, setWebsite] = useState('')
  const [nostr, setNostr] = useState('')
  const [email, setEmail] = useState('')
  const logotypeInputRef = useRef<HTMLInputElement>(null)
  const isotypoInputRef = useRef<HTMLInputElement>(null)
  const logo = useBlossomUpload()
  const iso = useBlossomUpload()

  // Restore local form state from the currently stored settings. Runs on
  // initial load and again when the page-level Cancel button is pressed.
  const loadFromSettings = useCallback(() => {
    if (!settings) return
    setCommunityName(settings.community_name ?? '')
    setLogotypePreview(settings.logotype_url?.trim() || null)
    setIsotypoPreview(settings.isotypo_url?.trim() || null)
    setWhatsapp(settings.social_whatsapp ?? '')
    setTelegram(settings.social_telegram ?? '')
    setDiscord(settings.social_discord ?? '')
    setTwitter(settings.social_twitter ?? '')
    setWebsite(settings.social_website ?? '')
    setNostr(settings.social_nostr ?? '')
    setEmail(settings.social_email ?? '')
  }, [settings])

  useEffect(() => {
    loadFromSettings()
  }, [loadFromSettings])

  // Revoke blob: object URLs on unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (logotypePreview?.startsWith('blob:')) URL.revokeObjectURL(logotypePreview)
      if (isotypoPreview?.startsWith('blob:')) URL.revokeObjectURL(isotypoPreview)
    }
    // Cleanup only on unmount — we intentionally don't re-run when previews change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist branding to the Settings table when the page-level Save Changes
  // button is pressed. Theme and rounding come from useTheme; community name
  // lives in local state. Logo URLs are persisted inline on upload success.
  const save = useCallback(async () => {
    await updateSettings({
      brand_theme: activePreset.hex,
      brand_rounding: rounding,
      community_name: communityName.trim(),
      social_whatsapp: whatsapp.trim(),
      social_telegram: telegram.trim(),
      social_discord: discord.trim(),
      social_twitter: twitter.trim(),
      social_website: website.trim(),
      social_nostr: nostr.trim(),
      social_email: email.trim(),
    })
  }, [
    updateSettings,
    activePreset.hex,
    rounding,
    communityName,
    whatsapp,
    telegram,
    discord,
    twitter,
    website,
    nostr,
    email,
  ])

  const { markChanged } = useSettingsForm('branding', save, loadFromSettings)
  const logotypeSrc = logotypePreview ?? DEFAULT_LOGOTYPE_SRC
  const isotypoSrc = isotypoPreview ?? DEFAULT_ISOTYPO_SRC

  async function handleLogotypeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset the input so selecting the same file again re-fires onChange.
    e.target.value = ''
    if (!file || !validateImageFile(file)) return
    if (logo.uploading) return

    const previous = logotypePreview
    const localUrl = URL.createObjectURL(file)
    setLogotypePreview(localUrl)

    try {
      const { url } = await logo.upload(file)
      setLogotypePreview(url)
      if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl)
      await updateSettings({ logotype_url: url })
      toast.success('Logotype updated')
    } catch (err) {
      // Restore the previous preview on failure; keep the blob around briefly
      // so the user sees what they picked.
      setLogotypePreview(previous)
      if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl)
      const message = err instanceof Error ? err.message : 'Upload failed'
      if (message !== 'Upload aborted') toast.error(message)
    }
  }

  async function handleIsotypoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !validateImageFile(file)) return
    if (iso.uploading) return

    const previous = isotypoPreview
    const localUrl = URL.createObjectURL(file)
    setIsotypoPreview(localUrl)

    try {
      const { url } = await iso.upload(file)
      setIsotypoPreview(url)
      if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl)
      await updateSettings({ isotypo_url: url })
      toast.success('Isotypo updated')
    } catch (err) {
      setIsotypoPreview(previous)
      if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl)
      const message = err instanceof Error ? err.message : 'Upload failed'
      if (message !== 'Upload aborted') toast.error(message)
    }
  }

  async function handleLogotypeRemove() {
    if (logo.uploading) return
    const previous = logotypePreview
    setLogotypePreview(null)
    if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous)
    try {
      await updateSettings({ logotype_url: '' })
      toast.success('Logotype removed')
    } catch (err) {
      setLogotypePreview(previous ?? null)
      const message = err instanceof Error ? err.message : 'Remove failed'
      toast.error(message)
    }
  }

  async function handleIsotypoRemove() {
    if (iso.uploading) return
    const previous = isotypoPreview
    setIsotypoPreview(null)
    if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous)
    try {
      await updateSettings({ isotypo_url: '' })
      toast.success('Isotypo removed')
    } catch (err) {
      setIsotypoPreview(previous ?? null)
      const message = err instanceof Error ? err.message : 'Remove failed'
      toast.error(message)
    }
  }

  return (
    <div className="flex flex-col gap-6 px-4 pt-10 pb-8 w-full max-w-[1024px] mx-auto">
      {/* Customization */}
      <div className="flex flex-col lg:flex-row gap-6 pb-8 border-b border-border">
        <div className="w-full lg:w-[420px] lg:shrink-0">
          <h3 className="text-lg font-medium">Customization</h3>
          <p className="text-sm text-muted-foreground">
            Customize your branding
          </p>
        </div>

        <div className="flex flex-col gap-6 flex-1 min-w-0">
          {/* Logotype */}
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground">Logotype</p>
            <div className="flex items-center gap-4 max-w-[360px]">
              <div className="relative flex h-12 w-40 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-black/40 px-3 py-2">
                <img
                  src={logotypeSrc}
                  alt={logotypePreview ? 'Logotype' : 'Default LaWallet logotype'}
                  className="h-full w-full object-contain"
                  onError={() => {
                    if (logotypePreview) setLogotypePreview(null)
                  }}
                />
                {logo.uploading && (
                  <>
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                      <Spinner size={16} />
                    </div>
                    <Progress
                      value={logo.progress}
                      className="absolute bottom-0 left-0 right-0 h-1 rounded-none"
                    />
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2 items-start">
                <input
                  ref={logotypeInputRef}
                  type="file"
                  accept={ACCEPT_ATTR}
                  className="hidden"
                  onChange={handleLogotypeChange}
                  data-track-change
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-xs w-auto"
                    disabled={logo.uploading}
                    onClick={() => logotypeInputRef.current?.click()}
                  >
                    {logo.uploading ? `Uploading… ${logo.progress}%` : 'Change'}
                  </Button>
                  {logotypePreview && !logo.uploading && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs w-auto text-muted-foreground"
                      onClick={handleLogotypeRemove}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {ACCEPTED_HINT}. 400x100px. Max 2mb.
                </p>
              </div>
            </div>
          </div>

          {/* Isotypo */}
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground">Isotypo</p>
            <div className="flex items-center gap-4 max-w-[320px]">
              <div className="size-16 shrink-0 rounded-md bg-muted relative overflow-hidden">
                <Image
                  src={isotypoSrc}
                  alt={isotypoPreview ? 'Isotypo' : 'Default LaWallet isotypo'}
                  fill
                  unoptimized
                  className="object-contain p-2"
                />
                {iso.uploading && (
                  <>
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                      <Spinner size={16} />
                    </div>
                    <Progress
                      value={iso.progress}
                      className="absolute bottom-0 left-0 right-0 h-1 rounded-none"
                    />
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2 items-start">
                <input
                  ref={isotypoInputRef}
                  type="file"
                  accept={ACCEPT_ATTR}
                  className="hidden"
                  onChange={handleIsotypoChange}
                  data-track-change
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-xs w-auto"
                    disabled={iso.uploading}
                    onClick={() => isotypoInputRef.current?.click()}
                  >
                    {iso.uploading ? `Uploading… ${iso.progress}%` : 'Change'}
                  </Button>
                  {isotypoPreview && !iso.uploading && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs w-auto text-muted-foreground"
                      onClick={handleIsotypoRemove}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {ACCEPTED_HINT}. 200x200px. Max 2mb.
                </p>
              </div>
            </div>
          </div>

          {/* Community Name */}
          <div className="flex flex-col gap-4 max-w-[320px]">
            <p className="text-sm text-foreground">Community Name</p>
            <Input
              placeholder="eg: My Community"
              value={communityName}
              onChange={e => {
                setCommunityName(e.target.value)
                markChanged()
              }}
            />
          </div>

          {/* Rounded */}
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground">Rounded</p>
            <div className="inline-flex items-center gap-1 bg-card border border-border rounded-lg p-1 w-fit">
              {roundingOptions.map((opt) => (
                <button
                  key={opt}
                  data-track-change
                  onClick={() => { setRounding(opt); markChanged() }}
                  className={cn(
                    'px-3 py-2.5 text-xs font-semibold rounded-md transition-colors shadow-sm',
                    rounding === opt
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-foreground hover:bg-secondary/50'
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Theme */}
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground">Theme</p>
            <div className="inline-flex items-center gap-1 bg-card border border-border rounded-lg p-1 w-fit">
              {presets.map((preset) => {
                const isActive = activePreset.hex === preset.hex
                return (
                  <button
                    key={preset.hex}
                    data-track-change
                    onClick={() => { setTheme(preset); markChanged() }}
                    className={cn(
                      'flex items-center justify-center p-2 rounded-md shadow-sm transition-colors',
                      isActive ? 'bg-secondary' : 'hover:bg-secondary/50'
                    )}
                    title={preset.name}
                  >
                    <div
                      className="relative size-4 rounded-full overflow-hidden"
                      style={{ backgroundColor: preset.hex }}
                    >
                      {isActive && (
                        <Check
                          className="absolute inset-0 m-auto size-2.5"
                          style={{
                            color: preset.name === 'Yellow' || preset.name === 'Neutral'
                              ? '#0a0a0a'
                              : '#ffffff',
                          }}
                          strokeWidth={3}
                        />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Social Media */}
      <div className="flex flex-col lg:flex-row gap-6 pb-8">
        <div className="w-full lg:w-[420px] lg:shrink-0">
          <h3 className="text-lg font-medium">Social Media</h3>
          <p className="text-sm text-muted-foreground">
            Lorem ipsum dolor sit amet.
          </p>
        </div>

        <div className="flex flex-col gap-6 flex-1 min-w-0">
          <SocialField
            label="WhatsApp"
            prefix="wa.me/"
            placeholder="+1 555 000 0000"
            value={whatsapp}
            onChange={v => { setWhatsapp(v); markChanged() }}
          />
          <SocialField
            label="Telegram"
            prefix="t.me/"
            placeholder="you-handle"
            value={telegram}
            onChange={v => { setTelegram(v); markChanged() }}
          />
          <SocialField
            label="Discord"
            prefix="discord.gg/"
            placeholder="invite-code"
            value={discord}
            onChange={v => { setDiscord(v); markChanged() }}
          />
          <SocialField
            label="X/Twitter"
            prefix="twitter.com/"
            placeholder="you-handle"
            value={twitter}
            onChange={v => { setTwitter(v); markChanged() }}
          />
          <SocialField
            label="Website"
            prefix="https://"
            placeholder="domain.com"
            value={website}
            onChange={v => { setWebsite(v); markChanged() }}
          />

          <div className="flex flex-col gap-4 max-w-[320px]">
            <p className="text-sm text-foreground">Nostr</p>
            <Input
              placeholder="npub..."
              value={nostr}
              onChange={e => { setNostr(e.target.value); markChanged() }}
            />
          </div>

          <div className="flex flex-col gap-4 max-w-[320px]">
            <p className="text-sm text-foreground">Email</p>
            <Input
              type="email"
              placeholder="you@email.com"
              value={email}
              onChange={e => { setEmail(e.target.value); markChanged() }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function SocialField({
  label,
  prefix,
  placeholder,
  value,
  onChange,
}: {
  label: string
  prefix: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-4 max-w-[320px]">
      <p className="text-sm text-foreground">{label}</p>
      <InputGroup>
        <InputGroupText>{prefix}</InputGroupText>
        <Input
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </InputGroup>
    </div>
  )
}
