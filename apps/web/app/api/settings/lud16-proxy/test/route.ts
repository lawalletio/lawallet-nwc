import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateSettingsWriteRequest } from '@/lib/settings-auth'
import { getListenerConfig } from '@/lib/listener-config'
import { listenerNwcRequest } from '@/lib/wallet/drivers/listener-transport'
import { getServerNwcClient } from '@/lib/wallet/drivers/nwc-client-cache'
import { withErrorHandling } from '@/types/server/error-handler'
import { getProxyConfig } from '@/lib/proxy/config'
import { PROXY_CONFIG_ID } from '@/lib/proxy/constants'
import { decryptProxySecret } from '@/lib/proxy/vault'

const REQUIRED_METHODS = [
  'make_invoice',
  'pay_invoice',
  'lookup_invoice',
  'get_balance'
]

export const POST = withErrorHandling(async (request: NextRequest) => {
  await authenticateSettingsWriteRequest(request)
  const config = await getProxyConfig()
  if (!config?.nwcCiphertext) {
    return NextResponse.json({
      ok: false,
      error: 'Save the proxy NWC connection before testing it'
    })
  }
  const connectionString = decryptProxySecret(
    config.nwcCiphertext,
    config.id,
    'nwc'
  )
  const listener = await getListenerConfig()
  try {
    let info: { methods?: string[]; notifications?: string[] }
    let balance: { balance: number }
    if (config.enabled && listener.enabled) {
      ;[info, balance] = await Promise.all([
        listenerNwcRequest<{
          methods?: string[]
          notifications?: string[]
        }>(listener, {
          connectionString,
          method: 'get_info'
        }),
        listenerNwcRequest<{ balance: number }>(listener, {
          connectionString,
          method: 'get_balance'
        })
      ])
    } else {
      // A new credential must be testable before the operator enables it.
      // Disabled proxy accounts are intentionally absent from listener's
      // live pool, so probe the NWC connection directly in that state.
      const client = await getServerNwcClient(connectionString)
      ;[info, balance] = await Promise.all([
        client.getInfo(),
        client.getBalance()
      ])
    }
    const methods = Array.isArray(info.methods) ? info.methods : []
    const missingMethods = REQUIRED_METHODS.filter(
      method => !methods.includes(method)
    )
    if (!Number.isSafeInteger(balance.balance) || balance.balance < 0) {
      throw new Error('Proxy wallet returned an invalid balance')
    }
    const ok = missingMethods.length === 0
    await prisma.proxyServiceConfig.update({
      where: { id: PROXY_CONFIG_ID },
      data: {
        capabilities: {
          methods,
          notifications: info.notifications ?? []
        },
        balanceMsats: BigInt(balance.balance),
        lastProbeAt: new Date(),
        lastListenerSeenAt:
          config.enabled && listener.enabled ? new Date() : undefined,
        lastProbeError: ok
          ? null
          : `Missing NWC methods: ${missingMethods.join(', ')}`
      }
    })
    return NextResponse.json({
      ok,
      balanceMsats: balance.balance,
      methods,
      notifications: info.notifications ?? [],
      missingMethods,
      ...(ok ? {} : { error: `Missing: ${missingMethods.join(', ')}` })
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await prisma.proxyServiceConfig.update({
      where: { id: PROXY_CONFIG_ID },
      data: { lastProbeAt: new Date(), lastProbeError: error }
    })
    return NextResponse.json({ ok: false, error })
  }
})
