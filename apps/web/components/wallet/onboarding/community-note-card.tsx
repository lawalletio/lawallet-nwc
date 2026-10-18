'use client'

import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/client/i18n'

export function CommunityNoteCard() {
  const t = useT().onboarding.welcome
  return (
    <div className="flex flex-1 flex-col justify-between py-6">
      <div className="space-y-8 pt-10">
        <div className="flex justify-center">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-nwc-purple/10 text-nwc-purple">
            <Sparkles className="size-10" />
          </div>
        </div>

        <div className="space-y-3 text-center">
          <h1 className="text-2xl font-semibold text-foreground">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.body}</p>
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4 text-sm text-muted-foreground space-y-2">
          <p className="font-medium text-foreground">{t.thingsToKnow}</p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>{t.tipKey}</li>
            <li>{t.tipAddress}</li>
            <li>{t.tipSats}</li>
          </ul>
        </div>
      </div>

      <Button asChild className="w-full h-12">
        <Link href="/wallet">{t.enter}</Link>
      </Button>
    </div>
  )
}
