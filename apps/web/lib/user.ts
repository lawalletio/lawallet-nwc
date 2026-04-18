import { randomUUID } from 'crypto'
import { AlbyHub } from './albyhub'
import { prisma } from './prisma'
import { getSettings } from './settings'

export async function createNewUser(pubkey: string) {
  const { alby_api_url, alby_bearer_token, alby_auto_generate } =
    await getSettings([
      'alby_api_url',
      'alby_bearer_token',
      'alby_auto_generate'
    ])
  const userId = randomUUID()

  const albyHub = new AlbyHub(alby_api_url, alby_bearer_token)

  const subAccount =
    alby_auto_generate === 'true'
      ? await albyHub.createSubAccount(`LaWallet-${userId}`)
      : null

  const user = await prisma.user.create({
    data: {
      id: userId,
      pubkey,
      nwc: subAccount?.pairingUri || null,
      createdAt: new Date(),
      albyEnabled: !!subAccount,
      albySubAccount: subAccount
        ? {
            create: {
              appId: subAccount.id,
              nwcUri: subAccount.pairingUri,
              username: subAccount.lud16,
              nostrPubkey: subAccount.walletPubkey
            }
          }
        : undefined
    },
    include: {
      // Pull only the primary address (at most one). All call sites that
      // historically read `user.lightningAddress` now read
      // `user.lightningAddresses[0]`. Include the linked nwcConnection
      // too so the return shape matches the `findUnique` path that feeds
      // `resolvePaymentRoute` — otherwise TS narrows the union to the
      // intersection and drops the field.
      lightningAddresses: {
        where: { isPrimary: true },
        take: 1,
        include: { nwcConnection: true },
      },
      albySubAccount: true,
      // Same shape as `findUnique` callers rely on — safe to include here
      // since a brand-new user has no connections; the array is just `[]`.
      nwcConnections: { where: { isPrimary: true }, take: 1 },
    }
  })

  return user
}
