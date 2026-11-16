import { decode } from 'light-bolt11-decoder'

/** Strip a `lightning:` URI prefix and whitespace; bolt11 is case-insensitive. */
export function normalizeInvoice(raw: string): string {
  return raw
    .trim()
    .replace(/^lightning:/i, '')
    .toLowerCase()
}

/**
 * Isomorphic bolt11 decode (browser + server) for display. Does NOT verify the
 * signature or recover the payee key — the server does that with `bolt11`.
 * Throws on undecodable input.
 */
export function decodeInvoiceFields(invoice: string) {
  const d = decode(normalizeInvoice(invoice))
  const get = (name: string): unknown => {
    const s = d.sections.find(section => section.name === name)
    return s && 'value' in s ? s.value : undefined
  }
  const str = (name: string) => (get(name) as string | undefined) ?? null

  const timestamp = get('timestamp') as number | undefined
  // `expiry` is the tag's duration; BOLT-11 defaults it to one hour.
  const expiresAtMs =
    timestamp !== undefined ? (timestamp + (d.expiry ?? 3600)) * 1000 : null
  const features = Object.entries(
    (get('feature_bits') as Record<string, unknown> | undefined) ?? {}
  ).flatMap(([name, v]) =>
    v === 'required' || v === 'supported'
      ? [`${name}${v === 'required' ? ' (required)' : ''}`]
      : []
  )
  const network = get('coin_network') as { bech32?: string } | undefined

  return {
    network: network?.bech32 ?? null,
    paymentHash: str('payment_hash'),
    amountMsats: str('amount'),
    description: str('description'),
    descriptionHash: str('description_hash'),
    createdAt:
      timestamp !== undefined ? new Date(timestamp * 1000).toISOString() : null,
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    minFinalCltvExpiry: (get('min_final_cltv_expiry') as number) ?? null,
    paymentSecret: str('payment_secret'),
    features,
    routeHints: d.route_hints.flat().map(hop => ({
        pubkey: hop.pubkey,
        shortChannelId: hop.short_channel_id,
        feeBaseMsat: hop.fee_base_msat,
        feeProportionalMillionths: hop.fee_proportional_millionths,
        cltvExpiryDelta: hop.cltv_expiry_delta
      }))
  }
}

export type DecodedInvoiceFields = ReturnType<typeof decodeInvoiceFields>
