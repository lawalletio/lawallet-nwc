import { Check, Minus } from 'lucide-react'
import { ProtocolInfoTrigger } from '@/components/wallet/shared/protocol-info'
import {
  PROTOCOL_REFERENCE,
  type ProtocolKey,
  type ProtocolState
} from '@/lib/protocols/reference'
import { cn } from '@/lib/utils'

/**
 * One protocol at a glance: a circled check when it's live, grayed out when
 * it isn't. Everything else — what the protocol does, and why it is or isn't
 * on here — is one click away in the shared protocol dialog.
 *
 * `state` is deliberately tri-state. `null` means "not checked": an aliased
 * address doesn't advertise its capabilities, and rendering it as unsupported
 * would be a claim nobody verified. It reads as off but carries a dashed
 * outline, and the tooltip and dialog say so in words.
 */
export function ProtocolChip({
  protocolKey,
  state,
  detail
}: {
  protocolKey: ProtocolKey
  state: ProtocolState
  detail?: string | null
}) {
  const unknown = state === null || state === undefined
  return (
    <ProtocolInfoTrigger
      protocolKey={protocolKey}
      state={state}
      detail={detail}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs font-medium',
          state
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : unknown
              ? 'border-dashed border-border bg-muted/40 text-muted-foreground'
              : 'border-border bg-muted/40 text-muted-foreground'
        )}
      >
        <span
          className={cn(
            'flex size-4 items-center justify-center rounded-full',
            state ? 'bg-emerald-500/20' : 'bg-muted-foreground/20'
          )}
        >
          {state ? (
            <Check className="size-3" aria-hidden />
          ) : (
            <Minus className="size-3" aria-hidden />
          )}
        </span>
        {PROTOCOL_REFERENCE[protocolKey].label}
      </span>
    </ProtocolInfoTrigger>
  )
}
