import { withErrorHandling } from '@/types/server/error-handler'

// Temporary route to verify Sentry capture on preview deploys.
// Removed before this PR leaves draft.
export const GET = withErrorHandling(async () => {
  throw new Error(
    'sentry-verification: nostr+walletconnect://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?relay=wss://r.example.com&secret=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )
})
