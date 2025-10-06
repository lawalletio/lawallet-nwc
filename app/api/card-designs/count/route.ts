import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateAdminAuth } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    await validateAdminAuth(request)
  } catch (response) {
    if (response instanceof NextResponse) {
      return response
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  const count = await prisma.cardDesign.count()
  return NextResponse.json({ count })
}
