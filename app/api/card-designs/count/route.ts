import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const count = await prisma.cardDesign.count()
  return NextResponse.json({ count })
}
