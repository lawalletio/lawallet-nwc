'use client'

import React, { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'

const ROUNDING_OPTIONS = ['None', 'Small', 'Medium', 'Full'] as const
const THEME_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
]

export function BrandingTab() {
  const [rounding, setRounding] = useState<string>('Medium')
  const [themeColor, setThemeColor] = useState<string>(THEME_COLORS[5])

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Customization</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the visual identity of your instance.
          </p>
        </div>
        <div className="flex flex-col gap-6">
          <div className="space-y-2">
            <Label>Logotype</Label>
            <div className="flex items-center gap-3">
              <div className="h-[50px] w-[150px] rounded bg-muted" />
              <Button variant="outline" size="sm">Change</Button>
              <Button variant="outline" size="sm">
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Isotype</Label>
            <div className="flex items-center gap-3">
              <div className="size-[50px] rounded bg-muted" />
              <Button variant="outline" size="sm">Change</Button>
              <Button variant="outline" size="sm">
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Community Name</Label>
            <Input placeholder="My Community" />
          </div>

          <div className="space-y-1">
            <Label>Short Name</Label>
            <Input placeholder="MC" />
          </div>

          <div className="space-y-2">
            <Label>Rounded</Label>
            <div className="flex">
              {ROUNDING_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setRounding(opt)}
                  className={`px-4 py-2 text-sm border first:rounded-l-md last:rounded-r-md -ml-px first:ml-0 transition-colors ${
                    rounding === opt
                      ? 'bg-secondary text-secondary-foreground border-secondary'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Theme</Label>
            <div className="flex items-center gap-2">
              {THEME_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setThemeColor(color)}
                  className={`size-8 rounded-full transition-all ${
                    themeColor === color ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Social Media</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Add your community social links.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <Label>WhatsApp</Label>
            <InputGroup>
              <InputGroupText>wa.me/</InputGroupText>
              <Input placeholder="+1 555 000 0000" className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
            </InputGroup>
          </div>

          <div className="space-y-1">
            <Label>Telegram</Label>
            <InputGroup>
              <InputGroupText>t.me/</InputGroupText>
              <Input placeholder="community" className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
            </InputGroup>
          </div>

          <div className="space-y-1">
            <Label>Discord</Label>
            <InputGroup>
              <InputGroupText>discord.gg/</InputGroupText>
              <Input placeholder="invite-code" className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
            </InputGroup>
          </div>

          <div className="space-y-1">
            <Label>X / Twitter</Label>
            <InputGroup>
              <InputGroupText>twitter.com/</InputGroupText>
              <Input placeholder="handle" className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
            </InputGroup>
          </div>

          <div className="space-y-1">
            <Label>Website</Label>
            <InputGroup>
              <InputGroupText>https://</InputGroupText>
              <Input placeholder="example.com" className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
            </InputGroup>
          </div>

          <div className="space-y-1">
            <Label>Nostr</Label>
            <Input placeholder="npub1..." />
          </div>

          <div className="space-y-1">
            <Label>Email</Label>
            <Input type="email" placeholder="hello@example.com" />
          </div>
        </div>
      </div>
    </div>
  )
}
