import { Prisma } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/types/server/errors'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { probeLightningAddressCapabilities } from '@/lib/lnurl-probe'
import {
  aliasProtocolsFromProbe,
  resolveAddressProtocols,
  type AddressProtocols,
  type StoredAliasProtocols
} from '@/lib/wallet/address-protocols'

export interface VerifyAddressProtocolsResult {
  username: string
  mode: string
  redirect: string | null
  /** True when this address's alias target was probed over the network. */
  probed: boolean
  /** True when `LightningAddress.aliasProtocols` was written. */
  persisted: boolean
  error: string | null
  previous: AddressProtocols
  protocols: AddressProtocols
}

const ADDRESS_INCLUDE = {
  remoteWallet: true,
  user: {
    select: {
      id: true,
      pubkey: true,
      nostrIdentities: {
        where: { isPrimary: true },
        select: { pubkey: true },
        take: 1
      }
    }
  }
} as const

/**
 * Re-resolve (and, for ALIAS addresses, re-probe) the protocols a lightning
 * address currently speaks. Addresses created before alias probing existed
 * have no stored `aliasProtocols` blob, so the admin list shows every LNURL
 * capability as unknown until this runs.
 */
export async function verifyAddressProtocols(
  username: string
): Promise<VerifyAddressProtocolsResult> {
  const address = await prisma.lightningAddress.findUnique({
    where: { username },
    include: ADDRESS_INCLUDE
  })
  if (!address) throw new NotFoundError('Address not found')

  let aliasProtocols: StoredAliasProtocols | null | undefined
  let probed = false
  let persisted = false
  let error: string | null = null

  const previous = await resolveAddressProtocols({
    mode: address.mode,
    redirect: address.redirect,
    aliasProtocols: address.aliasProtocols,
    routable: address.remoteWallet?.status === 'ACTIVE',
    user: address.user
  })

  if (address.mode === 'ALIAS' && address.redirect) {
    probed = true
    try {
      aliasProtocols = aliasProtocolsFromProbe(
        await probeLightningAddressCapabilities(address.redirect)
      )
    } catch (err) {
      aliasProtocols = null
      error = err instanceof Error ? err.message : 'Alias probe failed'
    }

    await prisma.lightningAddress.update({
      where: { username },
      data: {
        aliasProtocols: aliasProtocols
          ? (aliasProtocols as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull
      }
    })
    persisted = true

    eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
    logActivity.fireAndForget({
      category: 'ADDRESS',
      event: ActivityEvent.ADDRESS_UPDATED,
      message: `Address ${username} protocols re-verified`,
      userId: address.user.id,
      metadata: {
        username,
        redirect: address.redirect,
        probed: true,
        error
      }
    })
  }

  const protocols =
    aliasProtocols !== undefined
      ? await resolveAddressProtocols({
          mode: address.mode,
          redirect: address.redirect,
          aliasProtocols,
          routable: address.remoteWallet?.status === 'ACTIVE',
          user: address.user
        })
      : previous

  return {
    username: address.username,
    mode: address.mode,
    redirect: address.redirect,
    probed,
    persisted,
    error,
    previous,
    protocols
  }
}
