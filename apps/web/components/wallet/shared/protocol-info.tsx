'use client'

import { useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import {
  PROTOCOL_REFERENCE,
  protocolStateLabel,
  type ProtocolKey,
  type ProtocolState
} from '@/lib/protocols/reference'
import { cn } from '@/lib/utils'

function stateBadgeVariant(state: ProtocolState) {
  return state ? 'outline' : 'secondary'
}

function StateBadge({ state }: { state: ProtocolState }) {
  const unknown = state === null || state === undefined
  return (
    <Badge
      variant={stateBadgeVariant(state)}
      className={cn(
        state === true &&
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        unknown && 'border-dashed'
      )}
    >
      {protocolStateLabel(state)}
    </Badge>
  )
}

/**
 * Everything a reader might want about one protocol: what it is, what it makes
 * possible, whether this address has it, and where the spec lives.
 */
export function ProtocolInfoDialog({
  protocolKey,
  state,
  detail,
  open,
  onOpenChange
}: {
  protocolKey: ProtocolKey
  state: ProtocolState
  /** This address's specific situation, when there is something to add. */
  detail?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const info = PROTOCOL_REFERENCE[protocolKey]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>
              <span className="font-mono text-sm">{info.label}</span>{' '}
              <span>· {info.name}</span>
            </DialogTitle>
            <StateBadge state={state} />
          </div>
          <DialogDescription className="text-left">
            {info.summary}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {info.description}
        </p>

        {detail && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium">On this address</p>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          </div>
        )}

        <div>
          <p className="text-xs font-medium">What it makes possible</p>
          <ul className="mt-1.5 space-y-1">
            {info.useCases.map(useCase => (
              <li
                key={useCase}
                className="flex gap-2 text-xs text-muted-foreground"
              >
                <span aria-hidden className="text-muted-foreground/60">
                  —
                </span>
                <span>{useCase}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs font-medium">Specification</p>
          <ul className="mt-1.5 space-y-1">
            {info.specs.map(spec => (
              <li key={spec.href}>
                <a
                  href={spec.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  {spec.label}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A protocol as an interactive badge: hover for the one-liner, click for the
 * full explanation. Wraps whatever visual the surface wants — a round icon on
 * the address page, a compact chip in the list.
 */
export function ProtocolInfoTrigger({
  protocolKey,
  state,
  detail,
  children,
  className,
  ariaLabel
}: {
  protocolKey: ProtocolKey
  state: ProtocolState
  detail?: string | null
  children: ReactNode
  className?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const info = PROTOCOL_REFERENCE[protocolKey]

  return (
    <>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={
                ariaLabel ??
                `${info.label} — ${protocolStateLabel(state)}. Open details`
              }
              className={cn(
                'rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:opacity-80',
                className
              )}
            >
              {children}
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[16rem]">
            <p className="font-medium">
              {info.label} · {info.name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{info.summary}</p>
            {/* What is true HERE — who serves it when this address aliases
            another, or why it is off. Worth reading on hover, not only after
            opening the dialog. */}
            {detail && (
              <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
            )}
            <p className="mt-1 text-xs">
              {protocolStateLabel(state)} · click for details
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ProtocolInfoDialog
        protocolKey={protocolKey}
        state={state}
        detail={detail}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
