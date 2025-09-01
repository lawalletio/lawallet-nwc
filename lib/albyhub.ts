export interface AlbyCreateSubAccountResponse {
  pairingUri: string
  pairingSecretKey: string
  pairingPublicKey: string
  relayUrl: string
  walletPubkey: string
  lud16: string
  id: number
  name: string
  returnTo: string
}

export class AlbyHub {
  private readonly url: string
  private readonly bearerToken: string

  constructor(url: string, bearerToken: string) {
    console.info('Initializing AlbyHub with URL:', url)
    this.url = url
    this.bearerToken = bearerToken
  }

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
