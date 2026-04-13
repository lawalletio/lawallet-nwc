'use client'

import React, { useState } from 'react'
import { Plus, Minus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'

export function InfrastructureTab() {
  const [relays, setRelays] = useState<string[]>([''])

  function addRelay() {
    setRelays((prev) => [...prev, ''])
  }

  function removeRelay(index: number) {
    setRelays((prev) => prev.filter((_, i) => i !== index))
  }

  function updateRelay(index: number, value: string) {
    setRelays((prev) => prev.map((r, i) => (i === index ? value : r)))
  }

  return (
    <div className="flex flex-col gap-8 px-4 pt-10 pb-8 w-full max-w-[1024px] mx-auto">
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
