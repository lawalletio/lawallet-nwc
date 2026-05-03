import type { Metadata } from 'next'
import { ApiDocsClient } from './api-docs-client'

export const metadata: Metadata = {
  title: 'LaWallet NWC API Reference',
  description:
    'Interactive OpenAPI 3.1 reference with a NIP-98 signer powered by browser extensions (NIP-07).',
}

export default function ApiDocsPage() {
  return <ApiDocsClient />
}
