'use client'

import React from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Download,
  ExternalLink,
  KeyRound,
  Nfc,
  ScanLine,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/** Zapstore listing for the LaCrypta Card Installer Android app. */
const APP_URL = 'https://zapstore.dev/apps/com.lacrypta.cardinstaller'

/**
 * Step-by-step guide for provisioning many cards at once with the Card
 * Installer Android app: install the app, mint a device token (shown as a QR),
 * scan it to log in, then bulk-create cards by tapping each blank chip.
 */
export function BulkCardGuideDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 sm:max-w-[480px]">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-muted">
            <Nfc className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <DialogTitle>Initialize cards in bulk</DialogTitle>
          <DialogDescription>
            Program many NTAG424 cards quickly with the Card Installer Android
            app — create the card and tap it to your phone in one step.
          </DialogDescription>
        </DialogHeader>

        {/* `shrink-0` on the steps keeps them at natural height; the list
            scrolls on short viewports instead of squishing a step. */}
        <ol className="min-h-0 flex-1 space-y-5 overflow-y-auto py-4">
          <Step
            n={1}
            icon={<Download className="size-4" />}
            title="Install the Card Installer app"
          >
            <p className="text-sm text-muted-foreground">
              Get it from Zapstore on your Android phone — scan this code or open
              the link.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <div className="shrink-0 rounded-md bg-white p-2">
                <QRCodeSVG value={APP_URL} size={84} />
              </div>
              <a
                href={APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 break-all text-sm font-medium text-primary hover:underline"
              >
                zapstore.dev/apps/com.lacrypta.cardinstaller
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
            </div>
          </Step>

          <Step
            n={2}
            icon={<KeyRound className="size-4" />}
            title="Create a device token"
          >
            <p className="text-sm text-muted-foreground">
              In <strong>Settings → Device Tokens</strong>, pick a user and the
              card scopes, then <strong>Generate Token</strong> — it&apos;s shown
              as a QR code.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link
                href="/admin/settings?tab=device-tokens"
                onClick={() => onOpenChange(false)}
              >
                Open Device Tokens
                <ArrowRight className="ml-1 size-3.5" />
              </Link>
            </Button>
          </Step>

          <Step
            n={3}
            icon={<ScanLine className="size-4" />}
            title="Log in on the app"
          >
            <p className="text-sm text-muted-foreground">
              Open Card Installer, go to <strong>Login</strong>, and scan the
              device-token QR.
            </p>
          </Step>

          <Step
            n={4}
            icon={<Nfc className="size-4" />}
            title="Bulk create cards"
          >
            <p className="text-sm text-muted-foreground">
              Choose a design, then hold each blank card to the back of your
              phone until the screen says <strong>Done</strong>. Repeat for as
              many cards as you like.
            </p>
          </Step>
        </ol>

        <DialogFooter className="border-t pt-4">
          <Button variant="theme" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Step({
  n,
  icon,
  title,
  children,
}: {
  n: number
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex shrink-0 gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </h3>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  )
}
