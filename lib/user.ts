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
      lightningAddress: true,
      albySubAccount: true
    }
  })

  return user
}
