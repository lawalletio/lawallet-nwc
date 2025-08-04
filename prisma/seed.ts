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
          createdAt: user.createdAt,
          nwc: user.nwc
        }
      })
    )
  )
  console.log(`Created ${users.length} users`)

  // Create lightning addresses with their user relationships
  console.log('Creating lightning addresses...')
  await Promise.all(
    mockLightningAddressData.map((la, index) =>
      prisma.lightningAddress.create({
        data: {
          username: la.username,
          createdAt: la.createdAt,
          // Each lightning address belongs to a user with matching pubkey
          userId:
            mockUserData.find(u => u.pubkey === la.pubkey)?.id ||
            users[index].id
        }
      })
    )
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
