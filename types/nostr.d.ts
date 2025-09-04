import { NostrSigner } from '@nostrify/nostrify'

declare global {
  interface Window {
    nostr?: NostrSigner
  }
}

export {}
