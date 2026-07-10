import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { generateNtag424Values } from '@/lib/ntag424'
import { randomBytes } from 'crypto'
import { withErrorHandling } from '@/types/server/error-handler'
import { ConflictError } from '@/types/server/errors'
import { createCardSchema, cardListQuerySchema } from '@/lib/validation/schemas'
import { validateBody, validateQuery } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

interface CardFilters {
  paired?: boolean
  used?: boolean
}

export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.CARDS_READ)

  const query = validateQuery(request.url, cardListQuerySchema)

  // Parse filters from query params
  const filters: CardFilters = {
    paired: query.paired !== undefined ? query.paired === 'true' : undefined,
    used: query.used !== undefined ? query.used === 'true' : undefined
  }

  // Build where clause based on filters
  const where: any = {}

  // "Paired" === the card has an owner (`userId`). `otc` is unrelated — every
  // card is minted with one — so it must not drive this filter.
  if (filters.paired !== undefined) {
    if (filters.paired) {
      where.userId = { not: null }
    } else {
      where.userId = { equals: null }
    }
  }

  if (filters.used !== undefined) {
    if (filters.used) {
      where.lastUsedAt = { not: null }
    } else {
      where.lastUsedAt = { equals: null }
    }
  }

  const cards = await prisma.card.findMany({
    where,
    select: {
      id: true,
      createdAt: true,
      title: true,
      lastUsedAt: true,
      username: true,
      otc: true,
      remoteWalletId: true,
      kind: true,
      blockedAt: true,
      disabledAt: true,
      design: {
        select: {
          id: true,
          imageUrl: true,
          description: true,
          createdAt: true
        }
      },
      ntag424: {
        select: {
          cid: true,
          ctr: true,
          createdAt: true
        }
      },
      user: {
        select: {
          pubkey: true,
          // Card identity = the owner's primary lightning address, resolved
          // through the `userId` relation (not the dead `Card.username`).
          lightningAddresses: {
            where: { isPrimary: true },
            take: 1,
            select: { username: true }
          }
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  })

  // Transform to match Card type
  const transformedCards: Card[] = cards.map(card => ({
    id: card.id,
    design: card.design,
    ntag424: card.ntag424
      ? {
          ...card.ntag424,
          createdAt: card.ntag424.createdAt
        }
      : undefined,
    createdAt: card.createdAt,
    title: card.title || undefined,
    lastUsedAt: card.lastUsedAt || undefined,
    pubkey: card.user?.pubkey,
    username: card.user?.lightningAddresses?.[0]?.username || undefined,
    otc: card.otc || undefined,
    remoteWalletId: card.remoteWalletId ?? null,
    kind: card.kind,
    blocked: card.blockedAt !== null,
    disabled: card.disabledAt !== null
  }))

  return NextResponse.json(transformedCards)
})

export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await authenticateWithPermission(request, Permission.CARDS_WRITE)

  const { id, designId, kind } = await validateBody(request, createCardSchema)

  // Generate ntag424 values using the id as cid
  const serial = id.toUpperCase().replace(/:/g, '')
  const ntag424Values = generateNtag424Values(serial)

  // Generate random 16-byte string for otc
  const otc = randomBytes(16).toString('hex')

  // The UID is the NTAG424 primary key, so re-using one would otherwise blow
  // up as a 500 from the unique-constraint violation. Reject it up front with
  // a clear 409 instead.
  const conflictMessage = `A card with UID ${serial} already exists`
  const existingNtag = await prisma.ntag424.findUnique({
    where: { cid: serial },
    select: { cid: true }
  })
  if (existingNtag) {
    throw new ConflictError(conflictMessage)
  }

  // Create the ntag424 record first. The pre-check above handles the common
  // case; this catch covers the race where two creates share a UID — Prisma
  // maps the duplicate primary key to P2002.
  let ntag424
  try {
    ntag424 = await prisma.ntag424.create({
      data: ntag424Values
    })
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      throw new ConflictError(conflictMessage)
    }
    throw err
  }

  // Then create the card and link it to the ntag424
  const card = await prisma.card.create({
    data: {
      id: randomBytes(16).toString('hex'),
      designId,
      title: 'New Card',
      ntag424Cid: ntag424.cid, // Link to the created ntag424
      otc: otc, // Set the random 16-byte string for otc
      kind: kind ?? 'SIMPLE'
    } as any,
    select: {
      id: true,
      createdAt: true,
      title: true,
      lastUsedAt: true,
      username: true,
      otc: true,
      kind: true,
      design: {
        select: {
          id: true,
          imageUrl: true,
          description: true,
          createdAt: true
        }
      },
      ntag424: {
        select: {
          cid: true,
          k0: true,
          k1: true,
          k2: true,
          k3: true,
          k4: true,
          ctr: true,
          createdAt: true
        }
      },
      user: {
        select: {
          pubkey: true
        }
      }
    }
  })

  // Transform to match Card type
  const transformedCard: Card = {
    id: card.id,
    design: card.design,
    ntag424: card.ntag424
      ? {
          ...card.ntag424,
          createdAt: card.ntag424.createdAt
        }
      : undefined,
    createdAt: card.createdAt,
    title: card.title || undefined,
    lastUsedAt: card.lastUsedAt || undefined,
    pubkey: card.user?.pubkey,
    username: card.username || undefined,
    otc: card.otc || undefined,
    kind: card.kind
  }

  eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })

  logActivity.fireAndForget({
    category: 'CARD',
    event: ActivityEvent.CARD_CREATED,
    message: `New card created (design ${card.design.id})`,
    metadata: { cardId: card.id, designId: card.design.id }
  })

  return NextResponse.json(transformedCard)
})
