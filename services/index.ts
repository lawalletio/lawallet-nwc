// Export all services for easy importing
import { Ntag424Service } from './ntag424-service'
import { CardDesignService } from './card-design-service'
import { CardService } from './card-service'
import { LightningAddressService } from './lightning-address-service'

// Combined service class for convenience
export class MockDataService {
  static ntag424 = Ntag424Service
  static cardDesign = CardDesignService
  static card = CardService
  static lightningAddress = LightningAddressService

  /**
   * Get summary statistics across all services
   */
  static getSummary() {
    return {
      ntag424Count: Ntag424Service.count(),
      cardDesignCount: CardDesignService.count(),
      cardCount: CardService.count(),
      lightningAddressCount: LightningAddressService.count(),
      cardStatusCounts: CardService.getStatusCounts(),
      nwcStatusCounts: LightningAddressService.getNWCStatusCounts()
    }
  }

  /**
   * Get all data for export or backup
   */
  static getAllData() {
    return {
      ntag424: Ntag424Service.list(),
      cardDesigns: CardDesignService.list(),
      cards: CardService.list(),
      lightningAddresses: LightningAddressService.list()
    }
  }
}
