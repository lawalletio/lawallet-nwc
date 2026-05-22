import type { z } from 'zod'
import type { RemoteWalletType } from '@/lib/generated/prisma'

/**
 * Spendable balance reported by the remote wallet.
 *
 * Always normalised to **sats** at the driver boundary so call sites never
 * deal with the msat / sat ambiguity that bites every Lightning integration.
 * If the underlying protocol returns msats (NWC does), the driver divides
 * by 1000 — see `nwc-driver.ts`.
 */
export interface BalanceResult {
  /** Spendable balance, in sats. */
  balanceSats: number
}

/**
 * Payment request handed to {@link RemoteWalletDriver.payInvoice}.
 *
 * `amountSats` is only meaningful for zero-amount invoices — drivers MUST
 * ignore it (or pass through, depending on protocol) when the bolt11 already
 * encodes an amount, to avoid double-spending bugs.
 */
export interface PayInvoiceInput {
  /** BOLT11 invoice string. */
  bolt11: string
  /**
   * Amount in sats. Only used when `bolt11` is a zero-amount invoice; ignored
   * otherwise. The caller is responsible for confirming the amount with the
   * user — `payInvoice` is irrevocable once broadcast.
   */
  amountSats?: number
}

/** Result of a successful {@link RemoteWalletDriver.payInvoice} call. */
export interface PayInvoiceResult {
  /** Payment preimage, hex-encoded. */
  preimage: string
  /** Routing fees paid, in sats (rounded down from msats). */
  feesPaidSats: number
}

/**
 * Request handed to {@link RemoteWalletDriver.makeInvoice} to mint a BOLT11
 * invoice the wallet will receive into. Powers LUD-16 (Lightning Address)
 * receiving.
 */
export interface MakeInvoiceInput {
  /** Amount to request, in sats. Must be > 0. */
  amountSats: number
  /** Optional human-readable memo embedded in the invoice. */
  description?: string
}

/** Result of a successful {@link RemoteWalletDriver.makeInvoice} call. */
export interface MakeInvoiceResult {
  /** BOLT11 invoice string to hand back to the payer. */
  bolt11: string
  /** Payment hash, hex-encoded — used to look up / verify settlement later. */
  paymentHash: string
  /** Amount encoded in the invoice, in sats (normalised from msats). */
  amountSats: number
  /** Memo echoed back by the wallet (may differ from the requested one). */
  description: string
  /** Expiry as a unix-ms timestamp, or `null` if the wallet didn't report one. */
  expiresAt: number | null
}

/**
 * Strategy interface for every external wallet type the platform can attach
 * to a user (NWC today; LND / CLN / BTCPay later).
 *
 * Drivers translate the platform's protocol-agnostic operations
 * (`getBalance`, `payInvoice`, …) into whatever the underlying wallet speaks.
 * Call sites only ever look up a driver by `RemoteWallet.type` and invoke
 * the interface — adding a new wallet type is a new module plus a new
 * `RemoteWalletType` enum value, with **zero** call-site changes.
 *
 * @typeParam TConfig - Parsed shape of `RemoteWallet.config` for this driver.
 */
export interface RemoteWalletDriver<TConfig = unknown> {
  /** Discriminator — matches `RemoteWallet.type`. */
  readonly type: RemoteWalletType

  /**
   * Zod schema that validates and parses the wallet's `config` JSON column.
   * The registry uses this to narrow arbitrary input JSON into `TConfig`
   * before handing it to the driver, so individual methods can assume
   * valid output. Input is `unknown` because callers pass raw JSON that
   * may omit defaulted fields like `mode` on the NWC driver.
   */
  readonly configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>

  /**
   * Read the wallet's current spendable balance. Network round-trip; expect
   * latency on the order of a second for NWC over Nostr relays.
   *
   * @throws {DriverError} on validation, protocol, or remote errors.
   */
  getBalance(config: TConfig): Promise<BalanceResult>

  /**
   * Pay a BOLT11 invoice through the remote wallet. **Irrevocable** once
   * broadcast — callers must confirm with the user first.
   *
   * @throws {DriverError} on validation, protocol, or remote errors.
   */
  payInvoice(config: TConfig, input: PayInvoiceInput): Promise<PayInvoiceResult>

  /**
   * Mint a BOLT11 invoice for the wallet to receive into. Powers LUD-16
   * (Lightning Address) payments. A wallet provisioned without receive
   * capability (e.g. an NWC connection lacking `make_invoice`) will reject —
   * the driver surfaces that as a {@link DriverError} so callers can fall
   * back or report it.
   *
   * @throws {DriverError} on validation, protocol, or remote errors.
   */
  makeInvoice(config: TConfig, input: MakeInvoiceInput): Promise<MakeInvoiceResult>
}
