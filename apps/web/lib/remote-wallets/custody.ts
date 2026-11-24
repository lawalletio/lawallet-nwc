import type { RemoteWalletCustody } from '@/lib/generated/prisma'
import { ApiError } from '@/types/server/errors'

/** The custody values as clients see them on the wire. */
export type RemoteWalletCustodyWire = 'both' | 'backend' | 'local'

export function toWireCustody(
  custody: RemoteWalletCustody | null | undefined
): RemoteWalletCustodyWire {
  switch (custody) {
    case 'BACKEND':
      return 'backend'
    case 'LOCAL':
      return 'local'
    default:
      return 'both'
  }
}

export function fromWireCustody(
  custody: RemoteWalletCustodyWire
): RemoteWalletCustody {
  return custody.toUpperCase() as RemoteWalletCustody
}

/**
 * Whether the instance may hand this wallet's credentials (its NWC connection
 * string) to a client. Only `BOTH` wallets may: `BACKEND` credentials never
 * leave the instance, and the instance holds no copy of `LOCAL` ones.
 */
export function canRevealCredentials(wallet: {
  custody?: RemoteWalletCustody | null
}): boolean {
  return (wallet.custody ?? 'BOTH') === 'BOTH'
}

/**
 * A connection string the response may carry: the string itself for a `BOTH`
 * wallet, otherwise null. Use it wherever a response would include a wallet's
 * NWC URI, so a `BACKEND` wallet's credentials never reach a client.
 */
export function revealableConnectionString(
  wallet: { custody?: RemoteWalletCustody | null } | null | undefined,
  connectionString: string | null | undefined
): string | null {
  if (!wallet || !connectionString) return null
  return canRevealCredentials(wallet) ? connectionString : null
}

/**
 * 403 for a credentials request on a wallet whose custody forbids it. The
 * `code` lets clients tell it apart from other refusals and drop any copy of
 * the connection string they still hold.
 */
export class RemoteWalletCustodyError extends ApiError {
  constructor(custody: RemoteWalletCustody) {
    super(
      custody === 'LOCAL'
        ? 'This wallet’s credentials are kept only on the client'
        : 'This wallet’s credentials are kept on the server and are never revealed',
      {
        statusCode: 403,
        code: custody === 'LOCAL' ? 'CUSTODY_LOCAL' : 'CUSTODY_BACKEND',
        details: { custody: toWireCustody(custody) }
      }
    )
  }
}
