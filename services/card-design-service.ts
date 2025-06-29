import type { CardDesign } from "@/types/card-design"
import { mockCardDesignData } from "@/mocks/card-design"

export class CardDesignService {
  /**
   * Get all card designs
   */
  static list(): CardDesign[] {
    return mockCardDesignData
  }

  /**
   * Get a single card design by ID
   */
  static get(id: string): CardDesign | null {
    const design = mockCardDesignData.find((design) => design.id === id)
    return design || null
  }

  /**
   * Get card designs created after a specific date
   */
  static getCreatedAfter(date: Date): CardDesign[] {
    return mockCardDesignData.filter((design) => design.createdAt > date)
  }

  /**
   * Search card designs by description
   */
  static searchByDescription(query: string): CardDesign[] {
    const lowercaseQuery = query.toLowerCase()
    return mockCardDesignData.filter((design) => design.description.toLowerCase().includes(lowercaseQuery))
  }

  /**
   * Get the most recently created design
   */
  static getLatest(): CardDesign | null {
    if (mockCardDesignData.length === 0) return null

    return mockCardDesignData.reduce((latest, current) => (current.createdAt > latest.createdAt ? current : latest))
  }

  /**
   * Get total count of card designs
   */
  static count(): number {
    return mockCardDesignData.length
  }
}
