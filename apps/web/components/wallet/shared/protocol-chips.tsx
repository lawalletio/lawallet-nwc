'use client'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const PROTOCOL_LABELS = {
  lud16: 'LUD-16',
  nip05: 'NIP-05',
  lud21: 'LUD-21',
  nip57: 'NIP-57',
  lud12: 'LUD-12'
} as const

export type ProtocolKey = keyof typeof PROTOCOL_LABELS

/** What each protocol gives the person paying this address. */
const PROTOCOL_HELP: Record<ProtocolKey, { title: string; body: string }> = {
  lud16: {
    title: 'Lightning Address',
    body: 'The address resolves to a payRequest, so anyone can pay it by name instead of pasting an invoice.'
  },
  nip05: {
    title: 'Nostr identifier',
    body: 'This domain publishes the name in its nostr.json, so Nostr clients can verify it belongs to the owner.'
  },
  lud21: {
    title: 'Payment verification',
    body: 'Issued invoices carry a verify URL, letting the payer confirm settlement by payment hash without watching the invoice.'
  },
  nip57: {
    title: 'Zaps',
    body: 'Zap requests are accepted and a signed zap receipt is published once the payment settles.'
  },
  lud12: {
    title: 'Payer comments',
    body: 'The payer can attach a short note to the payment, which is stored and shown with it.'
  }
}

const STATE_NOTE = {
  on: 'Supported.',
  off: 'Not supported.',
  unknown: 'Not checked yet — save this address’s redirect to probe it.'
} as const

/**
 * The protocols an address speaks, at a glance. A protocol that could not be
 * determined is drawn as neither on nor off — an unprobed alias is not the same
 * as one that answered "no".
 */
export function ProtocolChips({
  protocols,
  className
}: {
  protocols: Partial<Record<ProtocolKey, boolean | null>>
  className?: string
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn('flex flex-wrap gap-1', className)}>
        {(Object.keys(PROTOCOL_LABELS) as ProtocolKey[]).map(key => {
          const state = protocols[key]
          const unknown = state === null || state === undefined
          const help = PROTOCOL_HELP[key]
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'cursor-help rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none',
                    state === true &&
                      'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                    state === false &&
                      'border-border bg-muted text-muted-foreground line-through decoration-muted-foreground/50',
                    unknown && 'border-dashed border-border text-muted-foreground'
                  )}
                >
                  {PROTOCOL_LABELS[key]}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[16rem]">
                <p className="font-medium">
                  {PROTOCOL_LABELS[key]} · {help.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {help.body}
                </p>
                <p className="mt-1 text-xs">
                  {unknown
                    ? STATE_NOTE.unknown
                    : state
                      ? STATE_NOTE.on
                      : STATE_NOTE.off}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
