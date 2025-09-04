import { randomUUID } from 'crypto'
import { AlbyHub } from './albyhub'
import { prisma } from './prisma'

const ALBY_API_URL = process.env.ALBY_API_URL!
const ALBY_BEARER_TOKEN = process.env.ALBY_BEARER_TOKEN!
const AUTO_GENERATE_ALBY_SUBACCOUNTS =
  process.env.AUTO_GENERATE_ALBY_SUBACCOUNTS === 'true'

export async function createNewUser(pubkey: string) {
  const userId = randomUUID()

  const albyHub = new AlbyHub(ALBY_API_URL, ALBY_BEARER_TOKEN)

  const subAccount = AUTO_GENERATE_ALBY_SUBACCOUNTS
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
