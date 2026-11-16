'use client'

import { ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { CheckboxCard } from '@/components/ui/checkbox-card'
import { Fieldset, FieldsetLegend } from '@/components/ui/field'
import type { OAuthScope } from '@/lib/oauth/constants'
import { cn } from '@/lib/utils'

/** How each OAuth scope is described to the user (consent and Connected apps). */
export const SCOPE_COPY: Record<OAuthScope, { label: string; detail: string }> =
  {
    read: {
      label: 'View balances, addresses, cards and activity',
      detail: "Read-only: it can't change anything."
    },
    write: {
      label: 'Create and change addresses, invoices and wallet settings',
      detail:
        'Includes choosing which of your own wallets receives payments. It cannot send funds.'
    },
    spend: {
      label: 'Send payments from your wallets',
      detail: 'Moves your funds, up to a daily limit you set.'
    }
  }

/**
 * The permission checkboxes of a connection (consent screen and Manage).
 * `read` is ticked and locked while `write` or `spend` is chosen, since both
 * imply it; `spend` is flagged Sensitive and highlighted when chosen.
 */
export function ScopeOptions({
  legend,
  scopes,
  chosen,
  readLocked,
  disabled,
  onToggle
}: {
  legend: string
  /** The scopes offered, in display order. */
  scopes: readonly OAuthScope[]
  chosen: readonly OAuthScope[]
  readLocked: boolean
  disabled?: boolean
  onToggle: (scope: OAuthScope, checked: boolean) => void
}) {
  const spend = chosen.includes('spend')
  return (
    <Fieldset className="gap-2">
      <FieldsetLegend className="mb-2 text-sm">{legend}</FieldsetLegend>
      {scopes.map(scope => {
        const locked = scope === 'read' && readLocked
        return (
          <CheckboxCard
            key={scope}
            checked={chosen.includes(scope)}
            onCheckedChange={checked => onToggle(scope, checked)}
            disabled={disabled || locked}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {SCOPE_COPY[scope].label}
                {scope === 'spend' && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-destructive/50 text-destructive"
                  >
                    <ShieldAlert className="size-3" />
                    Sensitive
                  </Badge>
                )}
              </span>
            }
            description={locked ? undefined : SCOPE_COPY[scope].detail}
            className={cn(
              scope === 'spend' &&
                spend &&
                'border-destructive/60 bg-destructive/5'
            )}
          />
        )
      })}
    </Fieldset>
  )
}
