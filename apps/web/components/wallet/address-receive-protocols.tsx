import { Radio, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ProtocolRow } from '@/components/wallet/shared/protocol-row'

export interface AddressReceiveProtocolsProps {
  /** `null` when it cannot be known without requesting an invoice (ALIAS). */
  lud21: boolean | null
  nip57: boolean
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
  lud21,
  nip57,
  source,
  reason,
  provider
}: AddressReceiveProtocolsProps) {
  const viaProxy = source === 'proxy'
  // An alias serves the destination's payRequest verbatim, so the payer deals
  // with that provider directly and these capabilities are its, not ours.
  const viaAlias = source === 'alias'
  const by = provider ? ` by ${provider}` : ''

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
        <ProtocolRow
          enabled={lud21}
          icon={<ShieldCheck className="size-4" />}
          title="LUD-21 verification"
          detail={
            lud21 === null
              ? `A payRequest does not advertise LUD-21, so this can only be confirmed${by} when an invoice is issued.`
              : lud21
                ? viaProxy
                  ? 'Enabled · proxy invoices expose a settlement verification URL.'
                  : 'Enabled · issued invoices expose a settlement verification URL.'
                : 'Unavailable until this address has an active receiving route.'
          }
        />
        <ProtocolRow
          enabled={nip57}
          icon={<Radio className="size-4" />}
          title="NIP-57 zaps"
          detail={
            nip57
              ? viaProxy
                ? 'Enabled · proxy receipts are signed and published after settlement.'
                : viaAlias
                  ? `Advertised${by} · zap receipts are signed by that provider.`
                  : 'Enabled · settled zap invoices publish a signed receipt.'
              : (reason ??
                'Unavailable until settlement detection and a receipt signer are ready.')
          }
        />
      </div>
    </section>
  )
}
