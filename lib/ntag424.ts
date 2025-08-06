import { Card } from '@/types'
import { Ntag424WriteData, Ntag424WipeData } from '@/types/ntag424'
import { randomBytes } from 'crypto'

export function cardToNtag424WriteData(
  card: Card,
  domain: string
): Ntag424WriteData {
  return {
    card_name: card.title || 'Unnamed',
    id: card.ntag424!.cid,
    k0: card.ntag424!.k0,
    k1: card.ntag424!.k1,
    k2: card.ntag424!.k2,
    k3: card.ntag424!.k3,
    k4: card.ntag424!.k4,
    lnurlw_base: `lnurlw://${domain}/api/cards/${card.id}/scan`,
    protocol_name: 'new_bolt_card_response',
    protocol_version: '1'
  }
}

export function cardToNtag424WipeData(card: Card): Ntag424WipeData {
  return {
    action: 'wipe',
    k0: card.ntag424!.k0,
    k1: card.ntag424!.k1,
    k2: card.ntag424!.k2,
    k3: card.ntag424!.k3,
    k4: card.ntag424!.k4,
    uid: card.ntag424!.cid,
    version: 1
  }
}

// Function to generate random ntag424 values
export function generateNtag424Values(cid: string) {
  return {
    cid,
    k0: randomBytes(16).toString('hex'),
    k1: randomBytes(16).toString('hex'),
    k2: randomBytes(16).toString('hex'),
    k3: randomBytes(16).toString('hex'),
    k4: randomBytes(16).toString('hex'),
    ctr: 0
  }
}
