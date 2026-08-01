/**
 * Runs data migrations that require application-owned secrets. SQL migrations
 * remain secret-free; the server does not accept traffic until this completes.
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'edge' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    return
  }
  const { migrateRemoteWalletNwcConfigs } =
    await import('@/lib/wallet/migrate-remote-wallet-vault')
  await migrateRemoteWalletNwcConfigs()

  const { initializeProxyReceiptSigner } =
    await import('@/lib/proxy/initialize-receipt-signer')
  await initializeProxyReceiptSigner()
}
