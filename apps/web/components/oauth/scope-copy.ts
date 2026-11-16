import type { OAuthScope } from '@/lib/oauth/constants'

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
