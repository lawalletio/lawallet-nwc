import { z } from 'zod'
import { DriverRemoteError } from './errors'
import { getServerNwcClient } from './nwc-client-cache'
import type {
  BalanceResult,
  PayInvoiceInput,
  PayInvoiceResult,
  RemoteWalletDriver,
} from './types'

/**
 * `RemoteWallet.config` shape for NWC wallets. We persist:
 *
 *  - `connectionString` — the NWC pairing URI. Everything derived from it
 *    (relay URL, wallet pubkey, …) is parsed by the SDK on every call, so
 *    there's only one source of truth here.
 *  - `mode` — `RECEIVE` (default) or `SEND_RECEIVE`. Mirrors the legacy
 *    `NWCConnection.mode` enum that the #231 migration copied forward into
 *    JSON. We default to `RECEIVE` so older payloads written before this
 *    field existed still parse.
 */
const nwcConfigSchema = z
  .object({
    connectionString: z
      .string()
      .min(1, 'connectionString is required')
      .refine(s => s.startsWith('nostr+walletconnect://') || s.startsWith('nostrwalletconnect://'), {
        message: 'connectionString must be a nostr+walletconnect:// URI',
      }),
    mode: z.enum(['RECEIVE', 'SEND_RECEIVE']).default('RECEIVE'),
  })
  .strict()

export type NwcDriverConfig = z.infer<typeof nwcConfigSchema>

/**
 * NWC driver — the first concrete {@link RemoteWalletDriver}. Wraps the
 * `@getalby/sdk` `NWCClient` so the rest of the platform never touches the
 * SDK directly. The driver:
 *
 *  - normalises msats → sats at the boundary (NWC speaks msats; the platform
 *    speaks sats end-to-end),
 *  - translates SDK errors into {@link DriverRemoteError} so callers can
 *    handle wallet failures uniformly across driver types,
 *  - shares relay subscriptions via {@link getServerNwcClient}.
 *
 * Capability detection (e.g. `make_invoice`) lives in higher-level callers
 * — every NWC wallet supports `get_balance` and `pay_invoice`, which are
 * the only methods this interface exposes today.
 */
export const nwcDriver: RemoteWalletDriver<NwcDriverConfig> = {
  type: 'NWC',
  configSchema: nwcConfigSchema,

  async getBalance(config): Promise<BalanceResult> {
    try {
      const client = await getServerNwcClient(config.connectionString)
      const res = await client.getBalance()
      return {
        balanceSats: Math.floor(res.balance / 1000),
      }
    } catch (err) {
      throw new DriverRemoteError('NWC get_balance failed', { cause: err })
    }
  },

  async payInvoice(config, input: PayInvoiceInput): Promise<PayInvoiceResult> {
    try {
      const client = await getServerNwcClient(config.connectionString)
      const res = await client.payInvoice({
        invoice: input.bolt11,
        // NWC takes msats; only pass it for zero-amount invoices so we don't
        // accidentally override the amount baked into a normal bolt11.
        amount: input.amountSats !== undefined ? input.amountSats * 1000 : undefined,
      })
      return {
        preimage: res.preimage,
        feesPaidSats: Math.floor((res.fees_paid ?? 0) / 1000),
      }
    } catch (err) {
      throw new DriverRemoteError('NWC pay_invoice failed', { cause: err })
    }
  },
}
