import type { LightningAddress } from '@/types/lightning-address'
import { mockLightningAddressData } from '@/mocks/lightning-address'

export class LightningAddressService {
  /**
   * Get all lightning addresses
   */
  static list(): LightningAddress[] {
    return mockLightningAddressData
  }

  /**
   * Get a single lightning address by username
   */
  static get(username: string): LightningAddress | null {
    const address = mockLightningAddressData.find(
      addr => addr.username === username
    )
    return address || null
  }

  /**
   * Get lightning address by pubkey
   */
  static getByPubkey(pubkey: string): LightningAddress | null {
    const address = mockLightningAddressData.find(
      addr => addr.pubkey === pubkey
    )
    return address || null
  }

  /**
   * Get lightning addresses with NWC connections
   */
  static getWithNWC(): LightningAddress[] {
    return mockLightningAddressData.filter(addr => addr.nwc !== undefined)
  }

  /**
   * Get lightning addresses without NWC connections
   */
  static getWithoutNWC(): LightningAddress[] {
    return mockLightningAddressData.filter(addr => addr.nwc === undefined)
  }

  /**
   * Get lightning addresses created after a specific date
   */
  static getCreatedAfter(date: Date): LightningAddress[] {
    return mockLightningAddressData.filter(addr => addr.createdAt > date)
  }

  /**
   * Search lightning addresses by username (partial match)
   */
  static searchByUsername(query: string): LightningAddress[] {
    const lowercaseQuery = query.toLowerCase()
    return mockLightningAddressData.filter(addr =>
      addr.username.toLowerCase().includes(lowercaseQuery)
    )
  }

  /**
   * Get lightning addresses by relay (from NWC connection)
   */
  static getByRelay(relayUrl: string): LightningAddress[] {
    return mockLightningAddressData.filter(
      addr => addr.nwc && addr.nwc.includes(encodeURIComponent(relayUrl))
    )
  }

  /**
   * Check if username is available
   */
  static isUsernameAvailable(username: string): boolean {
    return !mockLightningAddressData.some(addr => addr.username === username)
  }

  /**
   * Get total count of lightning addresses
   */
  static count(): number {
    return mockLightningAddressData.length
  }

  /**
   * Get count of addresses by NWC status
   */
  static getNWCStatusCounts(): {
    withNWC: number
    withoutNWC: number
  } {
    return {
      withNWC: this.getWithNWC().length,
      withoutNWC: this.getWithoutNWC().length
    }
  }

  /**
   * Get unique relay URLs from all NWC connections
   */
  static getUniqueRelays(): string[] {
    const relays = new Set<string>()

    mockLightningAddressData.forEach(addr => {
      if (addr.nwc) {
        try {
          const url = new URL(addr.nwc)
          const relayParam = url.searchParams.get('relay')
          if (relayParam) {
            relays.add(decodeURIComponent(relayParam))
          }
        } catch (error) {
          // Skip invalid URLs
        }
      }
    })

    return Array.from(relays)
  }
}
