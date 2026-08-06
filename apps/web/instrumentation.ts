import type { Instrumentation } from 'next'

/**
 * Runs data migrations that require application-owned secrets. SQL migrations
 * remain secret-free; the server does not accept traffic until this completes.
 *
 * Also initializes Sentry when SENTRY_DSN is set — with no DSN, nothing
 * Sentry-related is even imported.
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'edge' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    return
  }

  if (process.env.SENTRY_DSN) {
    const Sentry = await import('@sentry/nextjs')
    const { scrubEvent } = await import('@/lib/observability/pii')
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment:
        process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
      tracesSampleRate: 0.2,
      tracesSampler: ({ name }) =>
        name.includes('/api/health') || name.includes('/api/status') ? 0 : 0.2,
      sendDefaultPii: false,
      beforeSend: event => scrubEvent(event)
    })
  }

  const { migrateRemoteWalletNwcConfigs } =
    await import('@/lib/wallet/migrate-remote-wallet-vault')
  await migrateRemoteWalletNwcConfigs()

  const { initializeProxyReceiptSigner } =
    await import('@/lib/proxy/initialize-receipt-signer')
  await initializeProxyReceiptSigner()
}

export const onRequestError: Instrumentation.onRequestError = async (
  ...args
) => {
  if (!process.env.SENTRY_DSN || process.env.NEXT_RUNTIME === 'edge') return
  const Sentry = await import('@sentry/nextjs')
  return Sentry.captureRequestError(...args)
}
