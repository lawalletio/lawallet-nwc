export type Skin = {
  label: string // name
  value: string // id
  file: string | number // image url or require() object
}

export type LoginResponse = {
  skins: Skin[]
  lnurlwBase: string
}

export type CreateCardRequest = {
  designId: string
  cardUID: string
}

export type InitializeCardResponse = {
  k0: string
  k1: string
  k2: string
  k3: string
  k4: string
  privateUID: string
}
