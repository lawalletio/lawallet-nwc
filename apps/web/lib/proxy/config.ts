import { prisma } from '@/lib/prisma'
import type { ProxyServiceConfig } from '@/lib/generated/prisma'
import { decryptProxySecret } from './vault'
import { PROXY_CONFIG_ID } from './constants'

export interface ActiveProxyConfig {
  row: ProxyServiceConfig
  connectionString: string
  receiptPrivateKey: string | null
}

export async function getProxyConfig(): Promise<ProxyServiceConfig | null> {
  return prisma.proxyServiceConfig.findUnique({
    where: { id: PROXY_CONFIG_ID }
  })
}

export async function getActiveProxyConfig(): Promise<ActiveProxyConfig | null> {
  const row = await getProxyConfig()
  if (!row?.enabled || !row.nwcCiphertext) return null
  return decryptConfig(row)
}

/**
 * Existing paid settlements continue while new proxy intake is disabled.
 * Credential mutation is blocked while such rows exist, so this snapshot is
 * stable for the lifetime of every outstanding payment.
 */
export async function getProxySettlementConfig(): Promise<ActiveProxyConfig | null> {
  const row = await getProxyConfig()
  if (!row?.nwcCiphertext) return null
  return decryptConfig(row)
}

function decryptConfig(row: ProxyServiceConfig): ActiveProxyConfig {
  if (!row.nwcCiphertext) {
    throw new Error('Proxy NWC credential is not configured')
  }
  return {
    row,
    connectionString: decryptProxySecret(row.nwcCiphertext, row.id, 'nwc'),
    receiptPrivateKey: row.receiptNsecCiphertext
      ? decryptProxySecret(row.receiptNsecCiphertext, row.id, 'receipt-nsec')
      : null
  }
}
