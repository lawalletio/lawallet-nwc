import { AtSign, MessageSquare, Radio, ShieldCheck, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ProtocolRow } from '@/components/wallet/shared/protocol-row'

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
 * Capability snapshot for a Lightning Address. This intentionally describes
 * what the public LUD-16 endpoint is serving now, rather than merely which
 * options were selected in the address editor.
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
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
        <div>
          <h2 className="text-sm font-medium">Receive protocols</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {viaAlias && provider
              ? `Served by ${provider}, which this address aliases.`
              : 'Public capabilities for this Lightning Address.'}
          </p>
        </div>
        <Badge variant={viaProxy || viaAlias ? 'secondary' : 'outline'}>
          {viaProxy
            ? 'Served by proxy'
            : viaAlias
              ? 'Served by alias'
              : 'Current status'}
        </Badge>
      </div>
      <div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="divide-y divide-border/60">
          <ProtocolRow
            enabled={protocols.lud16 ?? null}
            protocolKey="lud16"
            icon={<Zap className="size-4" />}
            title="LUD-16 address"
            detail={
              protocols.lud16
                ? `Resolves a payRequest${served}.`
                : protocols.lud16 === null
                  ? 'Not checked yet.'
                  : 'This address does not resolve a payRequest.'
            }
          />
          <ProtocolRow
            enabled={protocols.nip05 ?? null}
            protocolKey="nip05"
            icon={<AtSign className="size-4" />}
            title="NIP-05 identifier"
            detail={
              protocols.nip05
                ? 'Published in this domain\u2019s nostr.json.'
                : 'The account has no usable Nostr public key.'
            }
          />
          <ProtocolRow
            enabled={protocols.lud12 ?? null}
            protocolKey="lud12"
            icon={<MessageSquare className="size-4" />}
            title="LUD-12 comments"
            detail={
              protocols.lud12
                ? `Payers can attach a comment${served}.`
                : protocols.lud12 === null
                  ? 'Not checked yet.'
                  : 'Payer comments are not accepted.'
            }
          />
        </div>
        <div className="divide-y divide-border/60">
          <ProtocolRow
            enabled={protocols.lud21 ?? null}
            protocolKey="lud21"
            icon={<ShieldCheck className="size-4" />}
            title="LUD-21 verification"
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
          <ProtocolRow
            enabled={protocols.nip57 ?? null}
            protocolKey="nip57"
            icon={<Radio className="size-4" />}
            title="NIP-57 zaps"
            detail={
              protocols.nip57
                ? viaProxy
                  ? 'Proxy receipts are signed and published after settlement.'
                  : viaAlias
                    ? `Advertised${served} \u00b7 receipts are signed by that provider.`
                    : 'Settled zap invoices publish a signed receipt.'
                : protocols.nip57 === null
                  ? 'Not checked yet.'
                  : (reason ??
                    'Unavailable until settlement detection and a receipt signer are ready.')
            }
          />
        </div>
      </div>
    </section>
  )
}
