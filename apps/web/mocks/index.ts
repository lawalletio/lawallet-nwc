// mocks/index.ts

// Import statements for mock data
import { mockNtag424Data } from './ntag424'
import { mockCardDesignData } from './card-design'
import { mockCardData } from './card'
import { mockLightningAddressData } from './lightning-address'

// Combined exports for convenience
export const mockData = {
  ntag424: mockNtag424Data,
  cardDesigns: mockCardDesignData,
  cards: mockCardData,
  lightningAddresses: mockLightningAddressData
}
