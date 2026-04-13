import type { User } from '@/types/user'

export const mockUserData: User[] = [
  {
    id: 'npub1xyz123abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890',
    pubkey: 'npub1xyz123abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890',
    createdAt: new Date('2024-01-10T08:00:00Z'),
    nwc: 'nostr+walletconnect://69effe7b49a6dd5cf525bd0905917a5005ffe480b58eeb8e861418cf3ae760d9?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&secret=d07195c8b86564c0d0c7c7d1c8b7e1a2f3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8'
  },
  {
    id: 'npub1abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890xyz123',
    pubkey: 'npub1abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890xyz123',
    createdAt: new Date('2024-01-15T12:30:00Z'),
    nwc: 'nostr+walletconnect://7a9ff8c5aa7ee6d0f636ce1a06a28b5106aff591c69ffb9f972529d04bf871ea?relay=wss%3A%2F%2Frelay.damus.io&secret=e18206d9c97675d1e1d8d8e2d9c8f2b3a4c5d6e7f8b9c0d1e2f3a4b5c6d7e8f9'
  },
  {
    id: 'npub1def789ghi012jkl345mno678pqr901stu234vwx567yz890xyz123abc456',
    pubkey: 'npub1def789ghi012jkl345mno678pqr901stu234vwx567yz890xyz123abc456',
    createdAt: new Date('2024-01-20T16:45:00Z')
  },
  {
    id: 'npub1ghi012jkl345mno678pqr901stu234vwx567yz890xyz123abc456def789',
    pubkey: 'npub1ghi012jkl345mno678pqr901stu234vwx567yz890xyz123abc456def789',
    createdAt: new Date('2024-01-25T09:20:00Z'),
    nwc: 'nostr+walletconnect://8baff9d6bb8ff7e1a747df2b17b39c6217baa6a2d7aafcaaa83639e15ca982fb?relay=wss%3A%2F%2Frelay.snort.social&secret=f29317eada8786e2f2e9e9f3eada9f3c4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9ea'
  },
  {
    id: 'npub1jkl345mno678pqr901stu234vwx567yz890xyz123abc456def789ghi012',
    pubkey: 'npub1jkl345mno678pqr901stu234vwx567yz890xyz123abc456def789ghi012',
    createdAt: new Date('2024-02-01T14:10:00Z'),
    nwc: 'nostr+walletconnect://9cbaa0e7cc9aa8f2b858ea3c28c4ad7328cbb7b3e8bbadbbba4749f26db093ac?relay=wss%3A%2F%2Frelay.primal.net&secret=a3a428fbeb9897f3a3fafaf4fbeb0a4d5c6d7e8f9a0b1c2d3e4f5a6b7c8d9eafb'
  },
  {
    id: 'npub1mno678pqr901stu234vwx567yz890xyz123abc456def789ghi012jkl345',
    pubkey: 'npub1mno678pqr901stu234vwx567yz890xyz123abc456def789ghi012jkl345',
    createdAt: new Date('2024-02-05T11:35:00Z'),
    nwc: 'nostr+walletconnect://adcbb1f8dd0bb9a3c969fb4d39d5be8439dcc8c4f9ccbecc cb5859a37ec1a4bd?relay=wss%3A%2F%2Frelay.nostr.band&secret=b4b539acfc0aa8a4b4abfbf5acfc1b5e6d7e8f9a0b1c2d3e4f5a6b7c8d9eafbac'
  },
  {
    id: 'npub1pqr901stu234vwx567yz890xyz123abc456def789ghi012jkl345mno678',
    pubkey: 'npub1pqr901stu234vwx567yz890xyz123abc456def789ghi012jkl345mno678',
    createdAt: new Date('2024-02-10T18:50:00Z')
  },
  {
    id: 'npub1stu234vwx567yz890xyz123abc456def789ghi012jkl345mno678pqr901',
    pubkey: 'npub1stu234vwx567yz890xyz123abc456def789ghi012jkl345mno678pqr901',
    createdAt: new Date('2024-02-15T07:25:00Z'),
    nwc: 'nostr+walletconnect://beccc2a9ee1ccab4da7aac5e4ae6cf954aeddad5aaddcfdddc6969b48ad2b5ce?relay=wss%3A%2F%2Frelay.nostrich.de&secret=c5c64abdad1bb9b5c5bcacf6bdad2c6f7e8f9a0b1c2d3e4f5a6b7c8d9eafbacbd'
  },
  {
    id: 'npub1vwx567yz890xyz123abc456def789ghi012jkl345mno678pqr901stu234',
    pubkey: 'npub1vwx567yz890xyz123abc456def789ghi012jkl345mno678pqr901stu234',
    createdAt: new Date('2024-02-20T13:40:00Z'),
    nwc: 'nostr+walletconnect://cfddd3baff2ddbbc5eb8bbd6f5bf7da65bfeeebe5beedaeeeed7a7ac59e3c6df?relay=wss%3A%2F%2Frelay.current.fyi&secret=d6d75bceee2ccac6d6cdcdad7ceee3d7a8a9b0c1d2e3f4a5b6c7d8e9afbcadce'
  },
  {
    id: 'npub1yz890xyz123abc456def789ghi012jkl345mno678pqr901stu234vwx567',
    pubkey: 'npub1yz890xyz123abc456def789ghi012jkl345mno678pqr901stu234vwx567',
    createdAt: new Date('2024-02-25T20:15:00Z'),
    nwc: 'nostr+walletconnect://daeee4cbaa3eeccddacccce7a6ca8eb76caafcfa6cafeebfafae8bbd6af4d7ea?relay=wss%3A%2F%2Frelay.orangepill.dev&secret=e7e86cdfaf3ddbd7e7dedebeadfaf4e8b9c0d1e2f3a4b5c6d7e8f9afbcadcedf'
  }
]
