import type { Card } from '@/types/card'
import { mockCardData } from '@/mocks/card'

export class CardService {
  /**
   * Get all cards
   */
  static list(): Card[] {
    return mockCardData
  }

  /**
   * Get a single card by ID
   */
  static get(id: string): Card | null {
    const card = mockCardData.find(card => card.id === id)
    return card || null
  }

  /**
   * Get cards by title (partial match)
   */
  static searchByTitle(query: string): Card[] {
    const lowercaseQuery = query.toLowerCase()
    return mockCardData.filter(card =>
      card.title.toLowerCase().includes(lowercaseQuery)
    )
  }

  /**
   * Get cards by pubkey
   */
  static getByPubkey(pubkey: string): Card[] {
    return mockCardData.filter(card => card.pubkey === pubkey)
  }

  /**
   * Get cards with NTAG424 chips (paired cards)
   */
  static getPairedCards(): Card[] {
    return mockCardData.filter(card => card.ntag424 !== undefined)
  }

  /**
   * Get cards without NTAG424 chips (unpaired cards)
   */
  static getUnpairedCards(): Card[] {
    return mockCardData.filter(card => card.ntag424 === undefined)
  }

  /**
   * Get cards that have been used (have lastUsedAt)
   */
  static getUsedCards(): Card[] {
    return mockCardData.filter(card => card.lastUsedAt !== undefined)
  }

  /**
   * Get cards that have never been used
   */
  static getUnusedCards(): Card[] {
    return mockCardData.filter(card => card.lastUsedAt === undefined)
  }

  /**
   * Get cards created after a specific date
   */
  static getCreatedAfter(date: Date): Card[] {
    return mockCardData.filter(card => card.createdAt > date)
  }

  /**
   * Get cards used after a specific date
   */
  static getUsedAfter(date: Date): Card[] {
    return mockCardData.filter(
      card => card.lastUsedAt && card.lastUsedAt > date
    )
  }

  /**
   * Get cards by design ID
   */
  static getByDesignId(designId: string): Card[] {
    return mockCardData.filter(card => card.design.id === designId)
  }

  /**
   * Get total count of cards
   */
  static count(): number {
    return mockCardData.length
  }

  /**
   * Get count of cards by status
   */
  static getStatusCounts(): {
    paired: number
    unpaired: number
    used: number
    unused: number
  } {
    return {
      paired: this.getPairedCards().length,
      unpaired: this.getUnpairedCards().length,
      used: this.getUsedCards().length,
      unused: this.getUnusedCards().length
    }
  }
}
