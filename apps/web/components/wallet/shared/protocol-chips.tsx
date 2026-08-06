import { cn } from '@/lib/utils'

export const PROTOCOL_LABELS = {
  lud16: 'LUD-16',
  nip05: 'NIP-05',
  lud21: 'LUD-21',
  nip57: 'NIP-57',
  lud12: 'LUD-12'
} as const

export type ProtocolKey = keyof typeof PROTOCOL_LABELS

const TITLES: Record<ProtocolKey, string> = {
  lud16: 'Lightning Address — resolves a payRequest',
  nip05: 'Nostr identifier published on this domain',
  lud21: 'Payers can verify settlement by payment hash',
  nip57: 'Settled zaps publish a signed receipt',
  lud12: 'Payers can attach a comment'
}

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
    <div className={cn('flex flex-wrap gap-1', className)}>
      {(Object.keys(PROTOCOL_LABELS) as ProtocolKey[]).map(key => {
        const state = protocols[key]
        const unknown = state === null || state === undefined
        return (
          <span
            key={key}
            title={
              unknown ? `${TITLES[key]} — not checked yet` : TITLES[key]
            }
            className={cn(
              'rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none',
              state === true &&
                'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              state === false &&
                'border-border bg-muted text-muted-foreground line-through decoration-muted-foreground/50',
              unknown && 'border-dashed border-border text-muted-foreground'
            )}
          >
            {PROTOCOL_LABELS[key]}
          </span>
        )
      })}
    </div>
  )
}
