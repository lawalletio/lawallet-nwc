import { Suspense } from 'react'
import {
  ConsentFallback,
  ConsentScreen
} from '@/components/oauth/consent-screen'

export const metadata = { title: 'Connect an app - LaWallet' }

// ConsentScreen reads the OAuth request with useSearchParams, which must sit
// under a Suspense boundary or the production build fails.
export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={<ConsentFallback />}>
      <ConsentScreen />
    </Suspense>
  )
}
