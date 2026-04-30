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
 */
export class AlbyHub {
  private readonly url: string
  private readonly bearerToken: string

  /**
   * @param url - Alby Hub base URL (e.g. `https://hub.example.com`).
   * @param bearerToken - Hub API token with permission to mint sub-accounts.
   */
  constructor(url: string, bearerToken: string) {
    console.info('Initializing AlbyHub with URL:', url)
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
    console.info('Creating sub account with name:', name)
    console.info('Sub account flag:', subAccount)
    console.info('Url:', `${this.url}/apps`)
    console.info('BearerToken:', this.bearerToken)

    const response = await fetch(`${this.url}/apps`, {
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

    console.info('Sub account creation response status:', response.status)

    if (!response.ok) {
      console.error('Failed to create sub account:', response.statusText)
      throw new Error('Failed to create sub account', {
        cause: response.statusText
      })
    }

    const data = (await response.json()) as AlbyCreateSubAccountResponse
    console.info('Successfully created sub account with ID:', data.id)
    return data
  }

  /**
   * Mints a Lightning Address on the hub bound to an existing app.
   *
   * @throws {Error} `'Failed to create a lightning address'` on a non-2xx response.
   */
  async createLightningAddress(username: string, appId: string) {
    console.info('Creating lightning address:', username)
    console.info('For app ID:', appId)

    const response = await fetch(`${this.url}/lightning-addresses`, {
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

    console.info('Lightning address creation response status:', response.status)

    if (!response.ok) {
      console.error('Failed to create lightning address:', response.statusText)
      throw new Error('Failed to create a lightning address', {
        cause: response.statusText
      })
    }

    console.info('Successfully created lightning address for:', username)
    return
  }
}
