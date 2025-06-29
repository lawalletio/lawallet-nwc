import type { Ntag424 } from '@/types/ntag424'
import { mockNtag424Data } from '@/mocks/ntag424'

export class Ntag424Service {
  /**
   * Get all NTAG424 chips
   */
  static list(): Ntag424[] {
    return mockNtag424Data
  }

  /**
   * Get a single NTAG424 chip by CID
   */
  static get(cid: string): Ntag424 | null {
    const ntag424 = mockNtag424Data.find(chip => chip.cid === cid)
    return ntag424 || null
  }

  /**
   * Get NTAG424 chips created after a specific date
   */
  static getCreatedAfter(date: Date): Ntag424[] {
    return mockNtag424Data.filter(chip => chip.createdAt > date)
  }

  /**
   * Get NTAG424 chips by counter range
   */
  static getByCounterRange(min: number, max: number): Ntag424[] {
    return mockNtag424Data.filter(chip => chip.ctr >= min && chip.ctr <= max)
  }

  /**
   * Get total count of NTAG424 chips
   */
  static count(): number {
    return mockNtag424Data.length
  }
}
