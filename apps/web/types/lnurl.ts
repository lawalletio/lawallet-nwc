export interface LnurlRequest {
  tag: 'withdrawRequest' | 'payRequest'
  callback: string
  metadata?: string
  defaultDescription?: string
}

export interface LUD03Request extends LnurlRequest {
  tag: 'withdrawRequest'
  k1: string
  minWithdrawable: number
  maxWithdrawable: number
  defaultDescription: string
}

export interface LUD03CallbackSuccess {
  status: 'OK'
}

export interface LUD03CallbackError {
  status: 'ERROR'
  reason: string
}

export interface LUD06Response {
  /**
   * Non-LNURL extension: this address takes coupon transfers on its callback.
   * Absent or false means don't send one. See docs/services/VOUCHERS.md.
   */
  allowVouchers?: boolean
  tag: 'payRequest'
  callback: string
  maxSendable: number
  minSendable: number
  metadata?: string
  payerData?: {
    name?: { mandatory: boolean }
    email?: { mandatory: boolean }
  }
  commentAllowed?: number
  allowsNostr?: boolean
  nostrPubkey?: string
}

export interface LUD06CallbackError {
  status: 'ERROR'
  reason: string
}

export interface LUD06CallbackSuccess {
  pr: string
  routes: []
  verify?: string
}

/**
 * LUD-21 verify response.
 * See: https://github.com/lnurl/luds/blob/luds/21.md
 */
export interface LUD21VerifySuccess {
  status: 'OK'
  settled: boolean
  preimage: string | null
  pr: string
}

export interface LUD21VerifyError {
  status: 'ERROR'
  reason: string
}
