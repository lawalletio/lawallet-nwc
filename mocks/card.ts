import type { Card } from '@/types/card'
import { mockCardDesignData } from './card-design'
import { mockNtag424Data } from './ntag424'

export const mockCardData: Card[] = [
  {
    id: 'card-001',
    title: 'My Daily Spending Card',
    design: mockCardDesignData[0],
    createdAt: new Date('2024-01-15T10:30:00Z'),
    ntag424: mockNtag424Data[0],
    lastUsedAt: new Date('2024-03-01T14:22:00Z'),
    pubkey: 'npub1xyz123abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890',
    username: 'pipo',
    otc: 'OTC789ABC123'
  },
  {
    id: 'card-002',
    title: 'Coffee Shop Card',
    design: mockCardDesignData[1],
    createdAt: new Date('2024-01-20T14:45:00Z'),
    ntag424: mockNtag424Data[1],
    lastUsedAt: new Date('2024-02-28T09:15:00Z'),
    pubkey: 'npub1abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890xyz123',
    username: 'lolata',
    otc: 'OTC456DEF789'
  },
  {
    id: 'card-003',
    title: 'Travel Expenses',
    design: mockCardDesignData[2],
    createdAt: new Date('2024-02-01T09:15:00Z'),
    ntag424: mockNtag424Data[2],
    lastUsedAt: new Date('2024-02-25T18:30:00Z'),
    username: 'chucho',
    pubkey: 'npub1def789ghi012jkl345mno678pqr901stu234vwx567yz890xyz123abc456'
  },
  {
    id: 'card-004',
    title: 'Emergency Fund Card',
    design: mockCardDesignData[3],
    createdAt: new Date('2024-02-10T16:20:00Z'),
    ntag424: mockNtag424Data[3],
    pubkey: 'npub1ghi012jkl345mno678pqr901stu234vwx567yz890xyz123abc456def789',
    otc: 'OTC123GHI456'
  },
  {
    id: 'card-005',
    title: 'Business Expenses',
    design: mockCardDesignData[4],
    createdAt: new Date('2024-02-15T11:55:00Z'),
    ntag424: mockNtag424Data[4],
    lastUsedAt: new Date('2024-02-29T13:45:00Z'),
    pubkey: 'npub1jkl345mno678pqr901stu234vwx567yz890xyz123abc456def789ghi012',
    username: 'mercato',
    otc: 'OTC890JKL234'
  },
  {
    id: 'card-006',
    title: 'Gift Card',
    design: mockCardDesignData[5],
    createdAt: new Date('2024-02-18T08:30:00Z'),
    ntag424: mockNtag424Data[5]
    // No ntag424 - unpaired card
    // No lastUsedAt - never used
    // No pubkey - not linked to user
    // No otc - not activated
  },
  {
    id: 'card-007',
    title: 'Student Discount Card',
    design: mockCardDesignData[6],
    createdAt: new Date('2024-02-20T13:10:00Z'),
    pubkey: 'npub1mno678pqr901stu234vwx567yz890xyz123abc456def789ghi012jkl345',
    username: 'chucho',
    ntag424: mockNtag424Data[5],
    // Has pubkey but no ntag424 - linked but not physically programmed
    // No lastUsedAt - never used
    otc: 'OTC567MNO890'
  },
  {
    id: 'card-008',
    title: 'Backup Card',
    design: mockCardDesignData[5],
    createdAt: new Date('2024-02-22T17:40:00Z'),
    lastUsedAt: new Date('2024-02-23T10:20:00Z'),
    ntag424: mockNtag424Data[4],
    // Has lastUsedAt but no ntag424 or pubkey - unusual edge case
    otc: 'OTC234PQR567'
  },
  {
    id: 'card-009',
    title: 'Test Card Alpha',
    design: mockCardDesignData[0],
    createdAt: new Date('2024-02-25T12:00:00Z'),
    ntag424: {
      cid: '04D63AFA442B56',
      k0: '55667788990011223344AABBCCDDEEFF',
      k1: 'AA99887766554433221100000000FEDC',
      k2: '6789ABCDEF0123456789ABCDEF012345',
      k3: '9876543210FEDCBA9876543210FEDCBA',
      k4: 'F6789ABCDEF6789ABCDEF5E4D3C2B1A0',
      ctr: 5,
      createdAt: new Date('2024-02-25T12:05:00Z')
    },
    pubkey: 'npub1pqr901stu234vwx567yz890xyz123abc456def789ghi012jkl345mno678',
    otc: 'OTC678STU901'
  },
  {
    id: 'card-010',
    title: 'VIP Member Card',
    design: mockCardDesignData[1],
    createdAt: new Date('2024-02-28T15:30:00Z'),
    ntag424: {
      cid: '04E74BFB331C47',
      k0: '66778899001122334455AABBCCDDEEFF',
      k1: '9988776655443322110000000000FEDC',
      k2: '789ABCDEF0123456789ABCDEF0123456',
      k3: '876543210FEDCBA9876543210FEDCBA9',
      k4: '6789ABCDEF6789ABCDEF6F5E4D3C2B1A',
      ctr: 2048,
      createdAt: new Date('2024-02-28T15:35:00Z')
    },
    lastUsedAt: new Date('2024-03-01T20:15:00Z'),
    pubkey: 'npub1stu234vwx567yz890xyz123abc456def789ghi012jkl345mno678pqr901',
    otc: 'OTC901VWX234'
  }
]
