import { Radio, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ProtocolRow } from '@/components/wallet/shared/protocol-row'
import { toNpub } from '@/lib/client/format'

export function RemoteWalletReceiveProtocols({
  active,
  capabilities
}: {
  active: boolean
  capabilities?: {
    lud21: true
    nip57: boolean
    receiptPubkey: string | null
    reason: string | null
  }
}) {
  const zapEnabled = active && capabilities?.nip57 === true
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/70">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <h2 className="font-semibold">Receive protocols</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Settlement verification and zap-receipt support for this wallet.
          </p>
        </div>
        <Badge variant={active ? 'secondary' : 'outline'}>
          {active ? 'Wallet active' : 'Wallet inactive'}
        </Badge>
      </div>
      <div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <ProtocolRow
          icon={<ShieldCheck className="size-4" />}
          title="LUD-21 verification"
          detail={
            active
              ? 'Enabled · senders can verify an issued invoice by payment hash.'
              : 'Available when this RemoteWallet is active.'
          }
          enabled={active}
        />
        <ProtocolRow
          icon={<Radio className="size-4" />}
          title="NIP-57 zaps"
          detail={
            zapEnabled
              ? 'Enabled · listener-confirmed payments publish a signed receipt.'
              : (capabilities?.reason ??
                'Requires an active wallet, listener, and zap receipt signer.')
          }
          enabled={zapEnabled}
        />
      </div>
      {zapEnabled && capabilities?.receiptPubkey && (
        <div className="border-t border-border/60 bg-muted/20 px-5 py-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Receipt signer</span>{' '}
          <code
            className="ml-1 break-all font-mono"
            title={capabilities.receiptPubkey}
          >
            {toNpub(capabilities.receiptPubkey)}
          </code>{' '}
          · exposed as NIP-05 <code>_</code> on this domain
        </div>
      )}
    </section>
  )
}
