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
