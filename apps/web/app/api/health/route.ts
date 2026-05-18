import { NextResponse } from 'next/server'
import { logger, withRequestLogging } from '@/lib/logger'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export const GET = withRequestLogging(async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json({
      status: 'ok',
      service: 'web',
      database: 'up'
    })
  } catch (error) {
    logger.error({ err: error }, 'health.database_unavailable')

    return NextResponse.json(
      {
        status: 'error',
        service: 'web',
        database: 'down'
      },
      {
        status: 503
      }
    )
  }
})
