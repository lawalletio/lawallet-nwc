import type { Metadata } from 'next'
import { EmailLanding } from '@/components/wallet/auth/email-landing'

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
  // The token lives in the URL fragment, but never leak the path either.
  referrer: 'no-referrer'
}

/**
 * `/admin/auth/email#token=…` — the magic link for sign-ins that started on
 * the landing page or dashboard (and email-link confirmations). Same landing
 * as `/wallet/auth/email`; the path decides where it continues.
 * `AdminLayoutShell` skips its login gate on `/admin/auth/*`.
 */
export default function AdminEmailLandingPage() {
  return <EmailLanding />
}
