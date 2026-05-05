import type { Metadata } from 'next'
import { ApiDocsClient } from './api-docs-client'

export const metadata: Metadata = {
  title: 'LaWallet NWC API Reference',
  description:
    'Interactive OpenAPI 3.1 reference with a NIP-98 signer powered by browser extensions (NIP-07).',
}

export default function ApiDocsPage() {
  return (
    <>
      {/* Hide Scalar's "Powered by Scalar" branding (footer link + sidebar
          version chip). Both link to scalar.com — selectors target the
          stable href so they survive Scalar class-name changes. */}
      <style>{`
        a[href="https://www.scalar.com"],
        .scalar-version-number,
        .disclaimerLink {
          display: none !important;
        }
      `}</style>
      <ApiDocsClient />
    </>
  )
}
