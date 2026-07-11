import { PrismaClient } from '../lib/generated/prisma'
import { mockUserData } from '../mocks/user'
import { mockLightningAddressData } from '../mocks/lightning-address'
import { mockNtag424Data } from '../mocks/ntag424'
import { mockCardDesignData } from '../mocks/card-design'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting seeding...')

  // Create users first since they are referenced by other entities
  console.log('Creating users...')
  const users = await Promise.all(
    mockUserData.map(user =>
      prisma.user.create({
        data: {
          id: user.id,
          pubkey: user.pubkey,
          createdAt: user.createdAt
        }
      })
    )
  )
  console.log(`Created ${users.length} users`)

  // Create RemoteWallet rows for users that have a seeded NWC URI. Mirrors the
  // forward-migration shape from 20260514120000_add_remote_wallet_schema: one
  // wallet per user, marked default, with the URI under config.connectionString.
  console.log('Creating remote wallets...')
  const remoteWallets = await Promise.all(
    mockUserData
      .filter(u => Boolean(u.nwc))
      .map(u =>
        prisma.remoteWallet.create({
          data: {
            userId: u.id,
            name: 'NWC Wallet',
            type: 'NWC',
            config: { connectionString: u.nwc as string, mode: 'RECEIVE' },
            status: 'ACTIVE',
            isDefault: true
          }
        })
      )
  )
  console.log(`Created ${remoteWallets.length} remote wallets`)

  // Create lightning addresses with their user relationships.
  // Each user gets exactly one address from the seed, so every seeded address
  // is its owner's primary — matches the back-fill behavior of the
  // addresses_nwc_connection migration for legacy rows. When the user has a
  // RemoteWallet, bind the address to it so the new code paths have data to
  // resolve against.
  console.log('Creating lightning addresses...')
  await Promise.all(
    mockLightningAddressData.map((la, index) => {
      const owner =
        mockUserData.find(u => u.pubkey === la.pubkey) ?? mockUserData[index]
      const wallet = remoteWallets.find(rw => rw.userId === owner.id)
      return prisma.lightningAddress.create({
        data: {
          username: la.username,
          createdAt: la.createdAt,
          isPrimary: true,
          userId: owner.id,
          mode: wallet ? 'CUSTOM_NWC' : 'IDLE',
          remoteWalletId: wallet?.id ?? null
        }
      })
    })
  )
  console.log(`Created ${mockLightningAddressData.length} lightning addresses`)

  // Create card designs
  console.log('Creating card designs...')
  const cardDesigns = await Promise.all(
    mockCardDesignData.map((design, index) =>
      prisma.cardDesign.create({
        data: {
          id: design.id,
          imageUrl: design.imageUrl,
          description: design.description,
          createdAt: design.createdAt,
          // Distribute designs among users
          userId: users[index % users.length].id
        }
      })
    )
  )
  console.log(`Created ${cardDesigns.length} card designs`)

  // Create Ntag424 entries and their associated cards
  console.log('Creating Ntag424 entries and cards...')
  await Promise.all(
    mockNtag424Data.map((ntag, index) =>
      prisma.ntag424.create({
        data: {
          cid: ntag.cid,
          k0: ntag.k0,
          k1: ntag.k1,
          k2: ntag.k2,
          k3: ntag.k3,
          k4: ntag.k4,
          ctr: ntag.ctr,
          createdAt: ntag.createdAt,
          userId: users[index % users.length].id,
          card: {
            create: {
              id: `card-${ntag.cid}`,
              designId: cardDesigns[index % cardDesigns.length].id,
              title: `Card ${index + 1}`,
              userId: users[index % users.length].id,
              username:
                mockLightningAddressData[
                  index % mockLightningAddressData.length
                ].username,
              otc: `OTC${ntag.cid.slice(-6)}${index.toString().padStart(3, '0')}`
            }
          }
        }
      })
    )
  )
  console.log(`Created ${mockNtag424Data.length} Ntag424 entries with cards`)

  console.log('✅ Seeding completed!')
}

main()
  .catch(e => {
    console.error('Error during seeding:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
