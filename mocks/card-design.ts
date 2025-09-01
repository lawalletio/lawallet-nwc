import type { CardDesign } from '@/types/card-design'

export const mockCardDesignData: CardDesign[] = [
  {
    id: 'design-001',
    imageUrl: '/card-primal.png',
    description: 'Primal card',
    createdAt: new Date('2024-01-10T08:00:00Z')
  },
  {
    id: 'design-002',
    imageUrl: '/card-alby.png',
    description: 'Alby Card',
    createdAt: new Date('2024-01-12T10:30:00Z')
  },
  {
    id: 'design-003',
    imageUrl: '/card-flash.png',
    description: 'Flash Card',
    createdAt: new Date('2024-01-15T14:20:00Z')
  },
  {
    id: 'design-004',
    imageUrl: '/card-curacao.png',
    description: 'Card Curacaeo',
    createdAt: new Date('2024-01-18T09:45:00Z')
  },
  {
    id: 'design-007',
    imageUrl: '/card-geyser.png',
    description: 'Geyser.fund',
    createdAt: new Date('2024-01-28T15:50:00Z')
  },
  {
    id: 'design-008',
    imageUrl: '/card-metal.png',
    description: 'Metal Test',
    createdAt: new Date('2024-01-28T15:50:00Z')
  }
]
