import { NextResponse } from 'next/server'
import { mockCardData } from '@/mocks/card'

export async function GET() {
  const statusCounts = {
    paired: mockCardData.filter(card => card.ntag424 !== undefined).length,
    unpaired: mockCardData.filter(card => card.ntag424 === undefined).length,
    used: mockCardData.filter(card => card.lastUsedAt !== undefined).length,
    unused: mockCardData.filter(card => card.lastUsedAt === undefined).length
  }

  return NextResponse.json(statusCounts)
}
