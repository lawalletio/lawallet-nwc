'use client'

import { ProtocolInfoTrigger } from '@/components/wallet/shared/protocol-info'
import {
  PROTOCOL_KEYS,
  PROTOCOL_REFERENCE,
  type ProtocolKey
} from '@/lib/protocols/reference'
import { cn } from '@/lib/utils'

export { PROTOCOL_KEYS, PROTOCOL_REFERENCE }
export type { ProtocolKey }

/**
 * The protocols an address speaks, at a glance. Each chip explains itself on
 * hover and opens the full reference on click.
 *
 * A protocol that could not be determined is drawn as neither on nor off — an
 * unprobed alias is not the same as one that answered "no".
 */
export function ProtocolChips({
  protocols,
  className
}: {
  protocols: Partial<Record<ProtocolKey, boolean | null>>
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {PROTOCOL_KEYS.map(key => {
        const state = protocols[key]
        const unknown = state === null || state === undefined
        return (
          <ProtocolInfoTrigger key={key} protocolKey={key} state={state}>
            <span
              className={cn(
                'block rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none',
                state === true &&
                  'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                state === false &&
                  'border-border bg-muted text-muted-foreground line-through decoration-muted-foreground/50',
                unknown && 'border-dashed border-border text-muted-foreground'
              )}
            >
              {PROTOCOL_REFERENCE[key].label}
            </span>
          </ProtocolInfoTrigger>
        )
      })}
    </div>
  )
}
