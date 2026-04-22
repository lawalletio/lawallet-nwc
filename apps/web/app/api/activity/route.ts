import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'
import { validateQuery } from '@/lib/validation/middleware'
import type { Prisma } from '@/lib/generated/prisma'

const CATEGORIES = ['USER', 'ADDRESS', 'NWC', 'INVOICE', 'CARD', 'SERVER'] as const
const LEVELS = ['INFO', 'WARN', 'ERROR'] as const

const listQuerySchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  level: z.enum(LEVELS).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(v => Math.min(100, Math.max(1, Number(v))))
    .optional(),
})

export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.ACTIVITY_READ)

  const params = validateQuery(new URL(request.url), listQuerySchema)
  const limit = params.limit ?? 20

  const where: Prisma.ActivityLogWhereInput = {}
  if (params.category) where.category = params.category
  if (params.level) where.level = params.level
  if (params.q) {
    where.message = { contains: params.q, mode: 'insensitive' }
  }

  // Keyset pagination: order by createdAt desc, id desc; use the cursor id as
  // the anchor. Simpler than offset-based, and safe across inserts streaming
  // from the live bus.
  const cursor = params.cursor ? { id: params.cursor } : undefined

  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor, skip: 1 } : {}),
  })

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? items[items.length - 1]!.id : null

  return NextResponse.json({ items, nextCursor })
})
