'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'
import { useTheme } from '@/lib/client/theme-context'
import { cn } from '@/lib/utils'
import { useSettings, useUpdateSettings } from '@/lib/client/hooks/use-settings'
import { useSettingsForm } from '@/components/admin/settings/settings-form-context'

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function validateImageFile(file: File) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    alert('Only JPG, PNG or WebP files are accepted.')
    return false
  }
  if (file.size > MAX_FILE_SIZE) {
    alert('File must be smaller than 2MB.')
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
  const logotypeInputRef = useRef<HTMLInputElement>(null)
  const isotypoInputRef = useRef<HTMLInputElement>(null)

  // Hydrate community name from server
  useEffect(() => {
    if (settings?.community_name !== undefined) {
      setCommunityName(settings.community_name ?? '')
    }
  }, [settings?.community_name])

  // Persist branding to the Settings table when the page-level Save Changes
  // button is pressed. Theme and rounding come from useTheme; community name
  // lives in local state.
  const save = useCallback(async () => {
    await updateSettings({
      brand_theme: activePreset.hex,
      brand_rounding: rounding,
      community_name: communityName.trim(),
    })
  }, [updateSettings, activePreset.hex, rounding, communityName])

  const { markChanged } = useSettingsForm('branding', save)

  function handleLogotypeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !validateImageFile(file)) return
    setLogotypePreview(URL.createObjectURL(file))
  }

  function handleIsotypoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !validateImageFile(file)) return
    setIsotypoPreview(URL.createObjectURL(file))
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
            <div className="flex items-center gap-4 max-w-[320px]">
              <div className="w-32 h-12 shrink-0 rounded-md bg-muted relative overflow-hidden">
                {logotypePreview && (
                  <Image src={logotypePreview} alt="Logotype" fill className="object-contain" />
                )}
              </div>
              <div className="flex flex-col gap-2 items-start">
                <input
                  ref={logotypeInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={handleLogotypeChange}
                  data-track-change
                />
                <Button variant="secondary" size="sm" className="text-xs w-auto" onClick={() => logotypeInputRef.current?.click()}>
                  Change
                </Button>
                <p className="text-sm text-muted-foreground">
                  JPG, PNG or WebP. 400x100px. Max 2mb.
                </p>
              </div>
            </div>
          </div>

          {/* Isotypo */}
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground">Isotypo</p>
            <div className="flex items-center gap-4 max-w-[320px]">
              <div className="size-16 shrink-0 rounded-md bg-muted relative overflow-hidden">
                {isotypoPreview && (
                  <Image src={isotypoPreview} alt="Isotypo" fill className="object-cover" />
                )}
              </div>
              <div className="flex flex-col gap-2 items-start">
                <input
                  ref={isotypoInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={handleIsotypoChange}
                  data-track-change
                />
                <Button variant="secondary" size="sm" className="text-xs w-auto" onClick={() => isotypoInputRef.current?.click()}>
                  Change
                </Button>
                <p className="text-sm text-muted-foreground">
                  JPG, PNG or WebP. 200x200px. Max 2mb.
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
          <SocialField label="WhatsApp" prefix="wa.me/" placeholder="+1 555 000 0000" />
          <SocialField label="Telegram" prefix="t.me/" placeholder="you-handle" />
          <SocialField label="Discord" prefix="discord.gg/" placeholder="invite-code" />
          <SocialField label="X/Twitter" prefix="twitter.com/" placeholder="you-handle" />
          <SocialField label="Website" prefix="https://" placeholder="domain.com" />

          <div className="flex flex-col gap-4 max-w-[320px]">
            <p className="text-sm text-foreground">Nostr</p>
            <Input placeholder="npub..." />
          </div>

          <div className="flex flex-col gap-4 max-w-[320px]">
            <p className="text-sm text-foreground">Email</p>
            <Input type="email" placeholder="you@email.com" />
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
}: {
  label: string
  prefix: string
  placeholder: string
}) {
  return (
    <div className="flex flex-col gap-4 max-w-[320px]">
      <p className="text-sm text-foreground">{label}</p>
      <InputGroup>
        <InputGroupText>{prefix}</InputGroupText>
        <Input
          placeholder={placeholder}
          className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </InputGroup>
    </div>
  )
}
