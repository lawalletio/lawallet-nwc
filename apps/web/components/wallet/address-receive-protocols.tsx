import { ProtocolChip } from '@/components/wallet/shared/protocol-chip'

export interface AddressReceiveProtocolsProps {
  /** Each may be `null` — "not determined", which is not "unsupported". */
  protocols: Partial<
    Record<'lud16' | 'nip05' | 'lud21' | 'nip57' | 'lud12', boolean | null>
  >
  source: 'proxy' | 'wallet' | 'alias' | 'unavailable'
  reason: string | null
  /** The address serving these capabilities, when it isn't this one. */
  provider?: string | null
}

/**
 * Capability snapshot for a Lightning Address, as one row of chips. This
 * describes what the public LUD-16 endpoint is serving now, rather than which
 * options were selected in the address editor — so who serves it (proxy,
 * alias) stays on the header badge, and the per-protocol specifics live in
 * each chip's dialog.
 */
export function AddressReceiveProtocols({
  protocols,
  source,
  reason,
  provider
}: AddressReceiveProtocolsProps) {
  const viaProxy = source === 'proxy'
  // An alias serves the destination's payRequest verbatim, so the payer deals
  // with that provider directly and these capabilities are its, not ours.
  const viaAlias = source === 'alias'
  const served = viaAlias && provider ? ` by ${provider}` : ''

  return (
    <section
      aria-label="Receive protocols"
      // `p-2` matches `gap-2`, so the ring of space around the chips is the
      // same as the space between them. Both margins need `!`: the parent
      // stack's `space-y-6` sets margin-top AND margin-bottom on its children
      // and wins on specificity, so a plain `mb-4` here resolves to 0.
      className="!mb-4 !mt-2 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-card p-2"
    >
      <ProtocolChip
        protocolKey="lud16"
        state={protocols.lud16 ?? null}
        detail={
          protocols.lud16
            ? `Resolves a payRequest${served}.`
            : protocols.lud16 === null
              ? 'Not checked yet.'
              : 'This address does not resolve a payRequest.'
        }
      />
      <ProtocolChip
        protocolKey="nip05"
        state={protocols.nip05 ?? null}
        detail={
          protocols.nip05
            ? 'Published in this domain’s nostr.json.'
            : 'The account has no usable Nostr public key.'
        }
      />
      <ProtocolChip
        protocolKey="lud12"
        state={protocols.lud12 ?? null}
        detail={
          protocols.lud12
            ? `Payers can attach a comment${served}.`
            : protocols.lud12 === null
              ? 'Not checked yet.'
              : 'Payer comments are not accepted.'
        }
      />
      <ProtocolChip
        protocolKey="lud21"
        state={protocols.lud21 ?? null}
        detail={
          protocols.lud21
            ? viaProxy
              ? 'Proxy invoices expose a settlement verification URL.'
              : `Issued invoices expose a settlement verification URL${served}.`
            : protocols.lud21 === null
              ? 'Not checked yet.'
              : 'Issued invoices expose no verification URL.'
        }
      />
      <ProtocolChip
        protocolKey="nip57"
        state={protocols.nip57 ?? null}
        detail={
          protocols.nip57
            ? viaProxy
              ? 'Proxy receipts are signed and published after settlement.'
              : viaAlias
                ? `Advertised${served} · receipts are signed by that provider.`
                : 'Settled zap invoices publish a signed receipt.'
            : protocols.nip57 === null
              ? 'Not checked yet.'
              : (reason ??
                'Unavailable until settlement detection and a receipt signer are ready.')
        }
      />
    </section>
  )
}
