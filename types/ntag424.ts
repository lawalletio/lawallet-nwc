export type Ntag424 = {
  cid: string
  k0: string
  k1: string // same as k3
  k2: string // same as k4
  k3: string // same as k1
  k4: string // same as k2
  ctr: number
  createdAt: Date
}

export type Ntag424WriteData = {
  card_name: string
  id: string
  k0: string
  k1: string // same as k3
  k2: string // same as k4
  k3: string // same as k1
  k4: string // same as k2
  lnurlw_base: `lnurlw://${string}`
  protocol_name: 'new_bolt_card_response'
  protocol_version: '1'
}

export type Ntag424WipeData = {
  action: 'wipe'
  k0: string
  k1: string // same as k3
  k2: string // same as k4
  k3: string // same as k1
  k4: string // same as k2
  uid: string
  version: 1
}
