'use client'

import React, { useRef, useState } from 'react'
import Image from 'next/image'
import { Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'
import { useTheme } from '@/lib/client/theme-context'
import { cn } from '@/lib/utils'

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function useImageUpload() {
  const [preview, setPreview] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) {
      alert('Only JPG, PNG or WebP files are accepted.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      alert('File must be smaller than 2MB.')
      return
    }
    setPreview(URL.createObjectURL(file))
  }

  return { preview, inputRef, handleChange, trigger: () => inputRef.current?.click() }
}

export function BrandingTab() {
  const { activePreset, setTheme, presets, rounding, setRounding, roundingOptions } = useTheme()
  const logotype = useImageUpload()
  const isotypo = useImageUpload()

  return (
    <div className="flex flex-col gap-6 px-4 pt-10 pb-8 w-full max-w-[1024px] mx-auto">
      {/* Customization */}
      <div className="flex flex-col lg:flex-row gap-6 pb-8 border-b border-border">
        <div className="w-full lg:w-[420px] lg:shrink-0">
          <h3 className="text-lg font-medium">Customization</h3>
          <p className="text-sm text-muted-foreground">
            Lorem ipsum dolor sit amet.
          </p>
        </div>

        <div className="flex flex-col gap-6 flex-1 min-w-0">
          {/* Logotype */}
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground">Logotype</p>
            <div className="flex items-center gap-4 max-w-[320px]">
              <div className="w-32 h-12 shrink-0 rounded-md bg-muted relative overflow-hidden">
                {logotype.preview && (
                  <Image src={logotype.preview} alt="Logotype" fill className="object-contain" />
                )}
              </div>
              <div className="flex flex-col gap-2 items-start">
                <input
                  ref={logotype.inputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={logotype.handleChange}
                  data-track-change
                />
                <Button variant="secondary" size="sm" className="text-xs w-auto" onClick={logotype.trigger}>
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
                {isotypo.preview && (
                  <Image src={isotypo.preview} alt="Isotypo" fill className="object-cover" />
                )}
              </div>
              <div className="flex flex-col gap-2 items-start">
                <input
                  ref={isotypo.inputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={isotypo.handleChange}
                  data-track-change
                />
                <Button variant="secondary" size="sm" className="text-xs w-auto" onClick={isotypo.trigger}>
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
            <Input placeholder="eg: My Community" />
          </div>

          {/* Rounded */}
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground">Rounded</p>
            <div className="inline-flex items-center gap-1 bg-card border border-border rounded-lg p-1 w-fit">
              {roundingOptions.map((opt) => (
                <button
                  key={opt}
                  data-track-change
                  onClick={() => setRounding(opt)}
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
                    onClick={() => setTheme(preset)}
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
