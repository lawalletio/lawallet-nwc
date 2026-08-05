import { Radio, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ProtocolRow } from '@/components/wallet/shared/protocol-row'

export interface AddressReceiveProtocolsProps {
  lud21: boolean
  nip57: boolean
  source: 'proxy' | 'wallet' | 'unavailable'
  reason: string | null
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
  reason
}: AddressReceiveProtocolsProps) {
  const viaProxy = source === 'proxy'

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
        <div>
          <h2 className="text-sm font-medium">Receive protocols</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Public capabilities for this Lightning Address.
          </p>
        </div>
        <Badge variant={viaProxy ? 'secondary' : 'outline'}>
          {viaProxy ? 'Served by proxy' : 'Current status'}
        </Badge>
      </div>
      <div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <ProtocolRow
          enabled={lud21}
          icon={<ShieldCheck className="size-4" />}
          title="LUD-21 verification"
          detail={
            lud21
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
                : 'Enabled · settled zap invoices publish a signed receipt.'
              : (reason ??
                'Unavailable until settlement detection and a receipt signer are ready.')
          }
        />
      </div>
    </section>
  )
}
