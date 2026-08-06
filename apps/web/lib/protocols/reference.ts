/**
 * One place describing the protocols a Lightning Address can speak.
 *
 * The address list and the address detail page both surface these, and they
 * used to word them differently. Keeping the copy here means a payer-facing
 * explanation is written once, and the spec link is always the real one.
 */

export const PROTOCOL_KEYS = [
  'lud16',
  'nip05',
  'lud21',
  'nip57',
  'lud12'
] as const

export type ProtocolKey = (typeof PROTOCOL_KEYS)[number]

export interface ProtocolReference {
  /** Short badge label. */
  label: string
  /** What the protocol does, in the reader's terms. */
  name: string
  /** One line, used in tooltips. */
  summary: string
  /** Fuller explanation for the dialog. */
  description: string
  /** Concrete things it makes possible. */
  useCases: string[]
  specs: Array<{ label: string; href: string }>
}

export const PROTOCOL_REFERENCE: Record<ProtocolKey, ProtocolReference> = {
  lud16: {
    label: 'LUD-16',
    name: 'Lightning Address',
    summary:
      'The address resolves to a payRequest, so it can be paid by name instead of by invoice.',
    description:
      'A Lightning Address looks like an email address. A wallet turns it into an HTTPS request for a payRequest document, then asks that endpoint for a fresh invoice each time. The payer never needs an invoice up front, and the address can be printed, shared or put on a profile without going stale.',
    useCases: [
      'Put a payable name on a profile, site or business card',
      'Receive without sending someone a new invoice every time',
      'Let another service pay you on a schedule'
    ],
    specs: [
      {
        label: 'LUD-16 · Paying to static internet identifiers',
        href: 'https://github.com/lnurl/luds/blob/luds/16.md'
      }
    ]
  },
  nip05: {
    label: 'NIP-05',
    name: 'Nostr identifier',
    summary:
      'This domain publishes the name in nostr.json, so clients can verify who owns it.',
    description:
      'NIP-05 maps a name on this domain to a Nostr public key, served from /.well-known/nostr.json. Clients fetch it to show a verified handle instead of a raw key. It says the domain vouches for that key — it is an identity claim, not a payment route, which is why it stays available even when the address is not taking payments.',
    useCases: [
      'Show a readable, verified handle in Nostr clients',
      'Prove a profile and this address belong to the same person',
      'Let others find the account by name rather than public key'
    ],
    specs: [
      {
        label: 'NIP-05 · Mapping Nostr keys to DNS identifiers',
        href: 'https://github.com/nostr-protocol/nips/blob/master/05.md'
      }
    ]
  },
  lud21: {
    label: 'LUD-21',
    name: 'Payment verification',
    summary:
      'Issued invoices carry a verify URL, so the payer can confirm settlement by payment hash.',
    description:
      'The callback returns a verify URL alongside the invoice. The payer polls it to learn whether the payment settled, and to get the preimage as proof, without holding the Lightning connection open or watching the invoice themselves. It is what makes a payment reliably confirmable by an automated buyer.',
    useCases: [
      'Unlock a purchase automatically once payment settles',
      'Let a payer retry safely, knowing whether the first attempt landed',
      'Reconcile payments from a script without a node'
    ],
    specs: [
      {
        label: 'LUD-21 · verify base spec',
        href: 'https://github.com/lnurl/luds/blob/luds/21.md'
      }
    ]
  },
  nip57: {
    label: 'NIP-57',
    name: 'Zaps',
    summary:
      'Zap requests are accepted and a signed receipt is published once payment settles.',
    description:
      'A zap is a Lightning payment with a Nostr note attached. The payer sends a signed zap request, and once the invoice settles the receiving service publishes a signed zap receipt to relays. Clients read those receipts to show who zapped what and how much — a payment without a receipt stays invisible on Nostr.',
    useCases: [
      'Receive zaps on notes and profiles, visible in Nostr clients',
      'Show public support totals on a post',
      'Prove a payment happened to anyone reading the relays'
    ],
    specs: [
      {
        label: 'NIP-57 · Lightning Zaps',
        href: 'https://github.com/nostr-protocol/nips/blob/master/57.md'
      }
    ]
  },
  lud12: {
    label: 'LUD-12',
    name: 'Payer comments',
    summary:
      'The payer can attach a short note, stored and shown with the payment.',
    description:
      'The payRequest advertises how many characters of comment it accepts. The payer may send one with the callback request, and it is kept with the payment rather than only being written into the invoice memo. Without it a payment arrives with no context beyond its amount.',
    useCases: [
      'Let a supporter say what a payment is for',
      'Carry an order or reference number with the payment',
      'Read who sent a tip and why, from the payment record'
    ],
    specs: [
      {
        label: 'LUD-12 · Comments in payRequest',
        href: 'https://github.com/lnurl/luds/blob/luds/12.md'
      }
    ]
  }
}

export type ProtocolState = boolean | null | undefined

export function protocolStateLabel(state: ProtocolState): string {
  if (state === null || state === undefined) return 'Not checked'
  return state ? 'Supported' : 'Not supported'
}
