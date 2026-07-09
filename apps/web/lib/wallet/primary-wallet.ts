import { prisma } from '@/lib/prisma'
import type {
  LightningAddressMode,
  Prisma,
  RemoteWallet,
} from '@/lib/generated/prisma'

type PrismaLike = typeof prisma | Prisma.TransactionClient

type AddressWalletLink<TWallet> = {
  mode: LightningAddressMode
  remoteWalletId: string | null
  remoteWallet?: TWallet | null
}

/**
 * The account primary wallet is defined by the account primary Lightning
 * Address. `isDefault` is only a synchronized display/compatibility flag.
 */
export function derivePrimaryWalletId(
  address: AddressWalletLink<unknown> | null | undefined,
): string | null {
  if (!address || address.mode !== 'CUSTOM_NWC') return null
  return address.remoteWalletId ?? null
}

export function derivePrimaryWallet<TWallet>(
  address: AddressWalletLink<TWallet> | null | undefined,
): TWallet | null {
  if (!derivePrimaryWalletId(address)) return null
  return address?.remoteWallet ?? null
}

export async function getPrimaryRemoteWalletForUser(
  userId: string,
  client: PrismaLike = prisma,
): Promise<RemoteWallet | null> {
  const primaryAddress = await client.lightningAddress.findFirst({
    where: { userId, isPrimary: true },
    include: { remoteWallet: true },
  })
  return derivePrimaryWallet(primaryAddress)
}

export async function getPrimaryRemoteWalletIdForUser(
  userId: string,
  client: PrismaLike = prisma,
): Promise<string | null> {
  const primaryAddress = await client.lightningAddress.findFirst({
    where: { userId, isPrimary: true },
    select: { mode: true, remoteWalletId: true },
  })
  return derivePrimaryWalletId(primaryAddress)
}

/**
 * Synchronize the legacy/display flag from the canonical primary-address link.
 * REVOKED/DEAD wallets cannot remain primary; DISABLED can stay selected but
 * will resolve as unconfigured for payment routes.
 */
export async function syncPrimaryRemoteWalletFlag(
  userId: string,
  client: PrismaLike = prisma,
): Promise<string | null> {
  const primaryWalletId = await getPrimaryRemoteWalletIdForUser(userId, client)

  await client.remoteWallet.updateMany({
    where: primaryWalletId
      ? { userId, isDefault: true, id: { not: primaryWalletId } }
      : { userId, isDefault: true },
    data: { isDefault: false },
  })

  if (!primaryWalletId) return null

  const updated = await client.remoteWallet.updateMany({
    where: {
      id: primaryWalletId,
      userId,
      status: { notIn: ['REVOKED', 'DEAD'] },
    },
    data: { isDefault: true },
  })

  return updated.count > 0 ? primaryWalletId : null
}

export async function bindPrimaryAddressToWallet(
  userId: string,
  walletId: string,
  client: PrismaLike = prisma,
): Promise<string | null> {
  const primaryAddress = await client.lightningAddress.findFirst({
    where: { userId, isPrimary: true },
    select: { username: true },
  })
  if (!primaryAddress) return null

  await client.lightningAddress.update({
    where: { username: primaryAddress.username },
    data: {
      mode: 'CUSTOM_NWC',
      redirect: null,
      remoteWalletId: walletId,
    },
  })
  await syncPrimaryRemoteWalletFlag(userId, client)
  return primaryAddress.username
}

export async function clearPrimaryWalletLinkToWallet(
  userId: string,
  walletId: string,
  client: PrismaLike = prisma,
): Promise<void> {
  await client.lightningAddress.updateMany({
    where: { userId, isPrimary: true, remoteWalletId: walletId },
    data: { mode: 'IDLE', redirect: null, remoteWalletId: null },
  })
  await syncPrimaryRemoteWalletFlag(userId, client)
}

export async function findInitialPrimaryWalletCandidate(
  userId: string,
  client: PrismaLike = prisma,
): Promise<Pick<RemoteWallet, 'id'> | null> {
  return client.remoteWallet.findFirst({
    where: { userId, status: 'ACTIVE' },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
}
