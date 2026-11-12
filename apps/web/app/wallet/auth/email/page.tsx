import type { Metadata } from 'next'
import { EmailLanding } from '@/components/wallet/auth/email-landing'

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
  // The token lives in the URL fragment, but never leak the path either.
  referrer: 'no-referrer'
}

/**
 * `/wallet/auth/email#token=…` — the magic-link landing. Sits outside the
 * `(auth)` group so its "already signed in → bounce" redirect can't race the
 * sign-in animation, and outside `(app)` because the user isn't signed in yet.
 */
export default function EmailLandingPage() {
  return <EmailLanding />
}
