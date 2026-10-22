'use client'

import { useT } from '@/lib/client/i18n'
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
  const t = useT().addresses.protocols
  const viaProxy = source === 'proxy'
  // An alias serves the destination's payRequest verbatim, so the payer deals
  // with that provider directly and these capabilities are its, not ours.
  const viaAlias = source === 'alias'
  const served = viaAlias && provider ? t.servedBy(provider) : ''

  return (
    <section
      aria-label={t.label}
      // `p-2` matches `gap-2`, so the ring of space around the chips is the
      // same as the space between them. Both margins need `!`: the parent
      // stack's `space-y-6` sets margin-top AND margin-bottom on its children
      // and wins on specificity, so a plain `mb-4` here resolves to 0.
      className="mb-4! mt-2! mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-card p-2"
    >
      <ProtocolChip
        protocolKey="lud16"
        state={protocols.lud16 ?? null}
        detail={
          protocols.lud16
            ? t.lud16Yes(served)
            : protocols.lud16 === null
              ? t.notChecked
              : t.lud16No
        }
      />
      <ProtocolChip
        protocolKey="nip05"
        state={protocols.nip05 ?? null}
        detail={protocols.nip05 ? t.nip05Yes : t.nip05No}
      />
      <ProtocolChip
        protocolKey="lud12"
        state={protocols.lud12 ?? null}
        detail={
          protocols.lud12
            ? t.lud12Yes(served)
            : protocols.lud12 === null
              ? t.notChecked
              : t.lud12No
        }
      />
      <ProtocolChip
        protocolKey="lud21"
        state={protocols.lud21 ?? null}
        detail={
          protocols.lud21
            ? viaProxy
              ? t.lud21Proxy
              : t.lud21Yes(served)
            : protocols.lud21 === null
              ? t.notChecked
              : t.lud21No
        }
      />
      <ProtocolChip
        protocolKey="nip57"
        state={protocols.nip57 ?? null}
        detail={
          protocols.nip57
            ? viaProxy
              ? t.nip57Proxy
              : viaAlias
                ? t.nip57Alias(served)
                : t.nip57Yes
            : protocols.nip57 === null
              ? t.notChecked
              : (reason ?? t.nip57Unavailable)
        }
      />
    </section>
  )
}
