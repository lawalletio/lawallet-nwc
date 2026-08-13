// @lawallet-nwc/sdk
// Nostr-first TypeScript client for LaWallet NWC instances.

export {
  LaWalletClient,
  type LaWalletClientOptions,
  type ClaimAddressOptions,
  type ClaimAddressResult
} from './client'

export { LaWalletError, type LaWalletApiError } from './errors'

export {
  nsecSigner,
  browserSigner,
  generateSigner,
  hasBrowserExtension,
  toNpub,
  type NostrSigner,
  type GeneratedSigner,
  type EventTemplate,
  type NostrEvent
} from './signer'

export {
  createNip98Token,
  createNip98QueryToken,
  bodyToPayload
} from './nip98'

export { pollVerifyUrl, checkVerifyOnce, type VerifyResult } from './lnurl'

export {
  subscribeEvents,
  ALL_SSE_EVENT_TYPES,
  type SSEEventType,
  type SSEStatus,
  type SubscribeEventsOptions,
  type EventSourceConstructor,
  type EventSourceLike
} from './sse'

export type {
  HttpClient,
  HttpRequestOptions,
  AuthHeaderProvider
} from './http'

export type * from './types'
