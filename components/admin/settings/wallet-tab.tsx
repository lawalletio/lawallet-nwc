'use client'

import React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'

export function WalletTab() {
  return (
    <div className="flex flex-col gap-8 px-4 pt-10 pb-8 w-full max-w-[1024px] mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Digital Wallet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the digital wallet for your instance.
          </p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enabled Mode</p>
              <p className="text-sm text-muted-foreground">
                Activate or deactivate the digital wallet.
              </p>
            </div>
            <Switch />
          </div>
        </div>
      </div>

      <Separator />

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
            <Switch />
          </div>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-6">
        <Label className="text-sm font-semibold">Control management</Label>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Disable Transfers</p>
              <p className="text-sm text-muted-foreground">
                Prevent users from sending and receiving transfers.
              </p>
            </div>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Disable Registers</p>
              <p className="text-sm text-muted-foreground">
                Prevent new user registrations.
              </p>
            </div>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Disable Address</p>
              <p className="text-sm text-muted-foreground">
                Disable Lightning Address functionality.
              </p>
            </div>
            <Switch />
          </div>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Lightning Address</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure Lightning Address settings and pricing.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enabled Mode</p>
              <p className="text-sm text-muted-foreground">
                Activate or deactivate Lightning Address service.
              </p>
            </div>
            <Switch />
          </div>
          <div className="space-y-1">
            <Label>Price</Label>
            <InputGroup>
              <InputGroupText>$</InputGroupText>
              <Input type="number" placeholder="0" className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
            </InputGroup>
          </div>
        </div>
      </div>
    </div>
  )
}
