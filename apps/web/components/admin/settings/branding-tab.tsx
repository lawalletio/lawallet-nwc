'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { useTheme, type ThemePreset, type RoundingOption } from '@/lib/client/theme-context'
import { cn } from '@/lib/utils'
import { useSettings } from '@/lib/client/hooks/use-settings'
import {
  useSettingSaver,
  SettingTextInput,
  SettingInputGroup,
} from '@/components/admin/settings/auto-save-controls'
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
  const saveSetting = useSettingSaver()
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
  const [roundingSaving, setRoundingSaving] = useState(false)
  const [themeSaving, setThemeSaving] = useState(false)
  const logotypeInputRef = useRef<HTMLInputElement>(null)
  const isotypoInputRef = useRef<HTMLInputElement>(null)
  const logo = useBlossomUpload()
  const iso = useBlossomUpload()

  // Restore local form state from the currently stored settings. With per-field
  // auto-save there's no Cancel/reset path, so we hydrate exactly once —
  // re-running on every refetch would clobber a field being actively edited.
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

  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current || !settings) return
    hydratedRef.current = true
    loadFromSettings()
  }, [settings, loadFromSettings])

  // Revoke blob: object URLs on unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (logotypePreview?.startsWith('blob:')) URL.revokeObjectURL(logotypePreview)
      if (isotypoPreview?.startsWith('blob:')) URL.revokeObjectURL(isotypoPreview)
    }
    // Cleanup only on unmount — we intentionally don't re-run when previews change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const logotypeSrc = logotypePreview ?? DEFAULT_LOGOTYPE_SRC
  const isotypoSrc = isotypoPreview ?? DEFAULT_ISOTYPO_SRC

  // Theme + rounding persist on selection. Optimistically apply for instant
  // preview, then revert if the save fails.
  async function handleRoundingChange(opt: RoundingOption) {
    const prev = rounding
    setRounding(opt)
    setRoundingSaving(true)
    try {
      await saveSetting({ brand_rounding: opt })
    } catch (err) {
      setRounding(prev)
      toast.error(err instanceof Error ? err.message : 'Failed to save rounding')
    } finally {
      setRoundingSaving(false)
    }
  }

  async function handleThemeChange(preset: ThemePreset) {
    const prev = activePreset
    setTheme(preset)
    setThemeSaving(true)
    try {
      await saveSetting({ brand_theme: preset.hex })
    } catch (err) {
      setTheme(prev)
      toast.error(err instanceof Error ? err.message : 'Failed to save theme')
    } finally {
      setThemeSaving(false)
    }
  }

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
      await saveSetting({ logotype_url: url })
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
      await saveSetting({ isotypo_url: url })
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
      await saveSetting({ logotype_url: '' })
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
      await saveSetting({ isotypo_url: '' })
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
            <SettingTextInput
              placeholder="eg: My Community"
              value={communityName}
              onValueChange={setCommunityName}
              save={v => saveSetting({ community_name: v.trim() })}
            />
          </div>

          {/* Rounded */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <p className="text-sm text-foreground">Rounded</p>
              {roundingSaving && <Spinner size={16} className="text-muted-foreground" />}
            </div>
            <div className="inline-flex items-center gap-1 bg-card border border-border rounded-lg p-1 w-fit">
              {roundingOptions.map((opt) => (
                <button
                  key={opt}
                  disabled={roundingSaving}
                  onClick={() => handleRoundingChange(opt)}
                  className={cn(
                    'px-3 py-2.5 text-xs font-semibold rounded-md transition-colors shadow-sm disabled:opacity-50',
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
            <div className="flex items-center gap-2">
              <p className="text-sm text-foreground">Theme</p>
              {themeSaving && <Spinner size={16} className="text-muted-foreground" />}
            </div>
            <div className="inline-flex items-center gap-1 bg-card border border-border rounded-lg p-1 w-fit">
              {presets.map((preset) => {
                const isActive = activePreset.hex === preset.hex
                return (
                  <button
                    key={preset.hex}
                    disabled={themeSaving}
                    onClick={() => handleThemeChange(preset)}
                    className={cn(
                      'flex items-center justify-center p-2 rounded-md shadow-sm transition-colors disabled:opacity-50',
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
            onValueChange={setWhatsapp}
            save={v => saveSetting({ social_whatsapp: v.trim() })}
          />
          <SocialField
            label="Telegram"
            prefix="t.me/"
            placeholder="you-handle"
            value={telegram}
            onValueChange={setTelegram}
            save={v => saveSetting({ social_telegram: v.trim() })}
          />
          <SocialField
            label="Discord"
            prefix="discord.gg/"
            placeholder="invite-code"
            value={discord}
            onValueChange={setDiscord}
            save={v => saveSetting({ social_discord: v.trim() })}
          />
          <SocialField
            label="X/Twitter"
            prefix="twitter.com/"
            placeholder="you-handle"
            value={twitter}
            onValueChange={setTwitter}
            save={v => saveSetting({ social_twitter: v.trim() })}
          />
          <SocialField
            label="Website"
            prefix="https://"
            placeholder="domain.com"
            value={website}
            onValueChange={setWebsite}
            save={v => saveSetting({ social_website: v.trim() })}
          />

          <div className="flex flex-col gap-4 max-w-[320px]">
            <p className="text-sm text-foreground">Nostr</p>
            <SettingTextInput
              placeholder="npub..."
              value={nostr}
              onValueChange={setNostr}
              save={v => saveSetting({ social_nostr: v.trim() })}
            />
          </div>

          <div className="flex flex-col gap-4 max-w-[320px]">
            <p className="text-sm text-foreground">Email</p>
            <SettingTextInput
              type="email"
              placeholder="you@email.com"
              value={email}
              onValueChange={setEmail}
              save={v => saveSetting({ social_email: v.trim() })}
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
  onValueChange,
  save,
}: {
  label: string
  prefix: string
  placeholder: string
  value: string
  onValueChange: (value: string) => void
  save: (value: string) => Promise<void>
}) {
  return (
    <div className="flex flex-col gap-4 max-w-[320px]">
      <p className="text-sm text-foreground">{label}</p>
      <SettingInputGroup
        prefix={prefix}
        placeholder={placeholder}
        value={value}
        onValueChange={onValueChange}
        save={save}
      />
    </div>
  )
}
