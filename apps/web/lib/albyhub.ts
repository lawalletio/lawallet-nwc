import { logger } from './logger'

/** Shape returned by `POST /apps` on Alby Hub for a new isolated sub-account. */
export interface AlbyCreateSubAccountResponse {
  /** NWC pairing URI to hand to the new user's wallet. */
  pairingUri: string
  pairingSecretKey: string
  pairingPublicKey: string
  relayUrl: string
  walletPubkey: string
  /** Lightning address minted by Alby for the sub-account. */
  lud16: string
  /** Alby-side numeric app id — keep this to wire follow-up calls. */
  id: number
  name: string
  returnTo: string
}

/**
 * Thin client for the self-hosted Alby Hub HTTP API. Used by the signup flow
 * to provision a per-user wallet and lightning address when the operator has
 * enabled the integration.
 *
 * The `bearerToken` (operator's Alby Hub admin API credential) is a secret:
 * it is only ever sent on the wire via the `Authorization` header and is never
 * written to logs — see `lib/user.ts:createNewUser` for the production caller.
 */
export class AlbyHub {
  private readonly url: string
  private readonly bearerToken: string
  private readonly log = logger.child({ module: 'albyhub' })

  /**
   * @param url - Alby Hub base URL (e.g. `https://hub.example.com`).
   * @param bearerToken - Hub API token with permission to mint sub-accounts.
   *   Treated as a secret; never logged.
   */
  constructor(url: string, bearerToken: string) {
    this.log.info({ url }, 'Initializing AlbyHub')
    this.url = url
    this.bearerToken = bearerToken
  }

  /**
   * Creates an isolated sub-account on the hub with the standard NWC scopes.
   *
   * @param name - Display name for the sub-account (typically `LaWallet-<userId>`).
   * @param subAccount - When `true` (default), tags the app with the
   *   `uncle-jim` metadata so it shows in Alby Hub's "Friends and Family" UI.
   * @throws {Error} `'Failed to create sub account'` on a non-2xx response.
   */
  async createSubAccount(name: string, subAccount: boolean = true) {
    const endpoint = `${this.url}/apps`
    this.log.info(
      { name, subAccount, url: endpoint },
      'Creating Alby sub-account'
    )

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },

      body: JSON.stringify({
        name: name,
        // maxAmount: 10000,
        scopes: [
          'pay_invoice',
          'get_balance',
          'make_invoice',
          'lookup_invoice',
          'list_transactions',
          'notifications'
        ],
        isolated: true,
        metadata: subAccount
          ? {
              app_store_app_id: 'uncle-jim'
            }
          : undefined
      })
    })

    this.log.info({ status: response.status }, 'Alby sub-account created')

    if (!response.ok) {
      this.log.error(
        { status: response.status, statusText: response.statusText },
        'Failed to create Alby sub-account'
      )
      throw new Error('Failed to create sub account', {
        cause: response.statusText
      })
    }

    const data = (await response.json()) as AlbyCreateSubAccountResponse
    this.log.info({ id: data.id }, 'Alby sub-account created')
    return data
  }

  /**
   * Mints a Lightning Address on the hub bound to an existing app.
   *
   * @throws {Error} `'Failed to create a lightning address'` on a non-2xx response.
   */
  async createLightningAddress(username: string, appId: string) {
    const endpoint = `${this.url}/lightning-addresses`
    this.log.info(
      { username, appId, url: endpoint },
      'Creating Alby lightning address'
    )

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        address: username,
        appId
      })
    })

    this.log.info(
      { status: response.status },
      'Alby lightning address creation response'
    )

    if (!response.ok) {
      this.log.error(
        { status: response.status, statusText: response.statusText },
        'Failed to create Alby lightning address'
      )
      throw new Error('Failed to create a lightning address', {
        cause: response.statusText
      })
    }

    this.log.info({ username }, 'Alby lightning address created')
    return
  }
}
