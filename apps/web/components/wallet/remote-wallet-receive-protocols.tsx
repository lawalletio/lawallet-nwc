import { ProtocolChip } from '@/components/wallet/shared/protocol-chip'
import { toNpub } from '@/lib/client/format'
import { useT } from '@/lib/client/i18n'

/**
 * The wallet's receive capabilities as two glanceable chips. Everything that
 * used to be spelled out here — what the protocol is, why it is or isn't on,
 * who signs the receipts — lives one click away in the shared protocol
 * dialog, which already holds the canonical copy for both surfaces.
 */
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
  const signer = capabilities?.receiptPubkey
  const p = useT().remoteWallets.protocols
  return (
    <section
      aria-label={p.label}
      // `p-2` matches `gap-2`: the space around the chips equals the space
      // between them.
      className="flex w-fit max-w-full flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card/70 p-2"
    >
      <ProtocolChip
        protocolKey="lud21"
        state={active}
        detail={active ? null : p.lud21Inactive}
      />
      <ProtocolChip
        protocolKey="nip57"
        state={zapEnabled}
        detail={
          zapEnabled
            ? signer
              ? p.receiptsSignedBy(toNpub(signer))
              : null
            : (capabilities?.reason ??
              p.zapRequirements)
        }
      />
    </section>
  )
}
